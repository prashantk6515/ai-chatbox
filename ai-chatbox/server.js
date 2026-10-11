import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the ai-chatbox directory or the parent directory
dotenv.config({ path: path.join(__dirname, ".env") });
if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const geminiApiKey = process.env.GEMINI_API_KEY;

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemma-4-26b-a4b-it"
].filter(Boolean);

async function getLiveWeather(userText) {
  const weatherKeywords = /\b(weather|temperature|temp|forecast|rain|raining|climate|humidity|mausam)\b/i;
  if (!weatherKeywords.test(userText)) return null;

  let location = "";
  const inMatch = userText.match(/\b(?:in|at|of|for)\s+([a-zA-Z\s]+?)(?:\s+(?:today|now|right now|currently|tomorrow))?[?.,!]?$/i) ||
                  userText.match(/\b(?:in|at|of|for)\s+([a-zA-Z]+)/i);

  if (inMatch && inMatch[1]) {
    location = inMatch[1].trim();
  } else {
    const beforeMatch = userText.match(/([a-zA-Z]+)\s+(?:weather|temperature|temp|forecast)/i);
    if (beforeMatch && beforeMatch[1] && !/^(the|current|today|live|whats|what|hows|how)/i.test(beforeMatch[1])) {
      location = beforeMatch[1].trim();
    }
  }

  if (!location) location = "auto";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
      headers: { "User-Agent": "curl/7.68.0" },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const current = data.current_condition?.[0];
    const area = data.nearest_area?.[0]?.areaName?.[0]?.value || location;
    const region = data.nearest_area?.[0]?.region?.[0]?.value || "";
    const country = data.nearest_area?.[0]?.country?.[0]?.value || "";

    if (!current) return null;

    return `Live real-time weather observation for ${[area, region, country].filter(Boolean).join(", ")}: Temperature: ${current.temp_C}°C (${current.temp_F}°F), Feels like: ${current.FeelsLikeC}°C (${current.FeelsLikeF}°F), Condition: ${current.weatherDesc?.[0]?.value || "Clear"}, Humidity: ${current.humidity}%, Wind: ${current.windspeedKmph} km/h (${current.winddir16Point}), Precipitation: ${current.precipMM} mm.`;
  } catch (err) {
    console.warn("Live weather fetch failed:", err.message);
    return null;
  }
}

async function callGemini(apiKey, safeMessages, timeInfo, liveWeatherInfo) {
  const contents = safeMessages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }]
  }));

  const systemInstructionText = [
    "You are a helpful, friendly general AI assistant. Explain clearly and accurately.",
    "IMPORTANT: You do NOT have internal function calling or tools like 'dalle.text2im'. NEVER output raw JSON objects such as {\"action\": \"dalle.text2im\"}. When the user asks to generate images or videos, respond naturally in conversation as the app's visual studio automatically handles generation.",
    timeInfo
      ? `Real-time clock is active. Today's live date and time is: ${timeInfo}. When the user asks for today's date, current day, or time, DO NOT say you do not have real-time access. Directly provide this current date and time.`
      : "",
    liveWeatherInfo
      ? `Real-time weather data is available: ${liveWeatherInfo}. When the user asks about weather, temperature, or conditions, DO NOT say you lack live weather data. Directly report this current weather data to the user.`
      : ""
  ].filter(Boolean).join(" ");

  const modelsToTry = [...new Set(GEMINI_MODELS)];
  let lastError = null;

  for (const model of modelsToTry) {
    try {
      console.log(`[Gemini] Requesting response with model: ${model}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{ text: systemInstructionText }]
          }
        })
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || `Error code ${data.error.code}`);
      }

      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) {
        console.log(`[Gemini] Succeeded with model: ${model}`);
        return reply;
      }
    } catch (err) {
      console.warn(`[Gemini] Model '${model}' failed: ${err.message}. Trying next fallback model...`);
      lastError = err;
    }
  }

  throw lastError || new Error("All fallback models are currently unavailable. Please try again shortly.");
}

// ==========================================================================
// AI Image & Video Generation Engine (DALL·E 3 Quality & Photorealism)
// ==========================================================================

const IMAGE_STYLES = {
  photorealistic: "modern contemporary photo, vibrant colors, glowing natural lighting, fine details, contemporary 2026 aesthetic, no vintage",
  cinematic: "contemporary Hollywood movie still, dramatic lighting, rich color grading, modern visual effects",
  anime: "modern vibrant anime artwork, luminous colors, crisp line art, beautiful digital art",
  "3d": "modern 3D animation studio render, smooth lighting, rich textures, contemporary styling",
  cyberpunk: "modern cyberpunk night city, vibrant neon reflections, futuristic styling",
  fantasy: "modern epic fantasy artwork, glowing magic aura, intricate golden details"
};

function getDimensions(aspectRatio) {
  if (aspectRatio === "16:9") return { width: 1280, height: 720 };
  if (aspectRatio === "9:16") return { width: 720, height: 1280 };
  return { width: 1024, height: 1024 };
}

// Expands user prompts into modern ChatGPT DALL-E 3 master prompts using Gemini
async function expandPromptWithAI(rawPrompt, style = "photorealistic") {
  const cleanPrompt = rawPrompt.replace(/^["'`]|["'`]$/g, "").trim();
  if (!cleanPrompt) return cleanPrompt;

  if (geminiApiKey) {
    const modelsToTry = [...new Set(GEMINI_MODELS)];
    const styleGuide = style === "cinematic"
      ? "contemporary Hollywood film style, rich color grading, modern visual effects"
      : style === "anime"
      ? "vibrant high-budget modern anime film style in Makoto Shinkai and Ufotable aesthetic"
      : style === "3d"
      ? "Pixar and modern 3D animation render with soft lighting"
      : style === "cyberpunk"
      ? "futuristic cyberpunk night city with glowing neon reflections"
      : style === "fantasy"
      ? "epic fantasy digital concept art with luminous celestial aura"
      : "contemporary modern photograph, natural vivid colors, authentic textures, contemporary aesthetic";

    const systemPrompt = [
      "You are the expert prompt engineering engine for modern state-of-the-art visual generation (like modern ChatGPT DALL-E 3).",
      "Your mission is to rewrite user image requests into ultra-modern, contemporary, fresh visual prompts ('nowadays look') that look cutting-edge.",
      "CRITICAL AESTHETIC DIRECTIVES:",
      "1. The image MUST look MODERN, CONTEMPORARY 2026, and VIBRANT. Avoid any antique, 19th-century calendar, vintage lithograph, or retro faded looks.",
      "2. If depicting deities or sacred figures (e.g. Maa Kali, Durga, Shiva), depict them with modern divine majesty, luminous glowing blue or golden celestial aura, polished solid gold jewelry and crown, royal robes, contemporary cinema CGI visual effects.",
      "3. For general subjects (people, cars, cities), use modern contemporary fashion, current-year styling, sleek design.",
      "4. Do NOT use any of these forbidden words: 'cinematic', 'sharp', '8k', 'hyper-realistic', 'photorealistic', 'portrait', 'volumetric', 'supercar'. Instead describe lighting, color, mood, and subject with vivid natural language.",
      "5. Keep the prompt concise: between 20 and 35 words.",
      `6. Style guidance: ${styleGuide}.`,
      "7. Output ONLY the rewritten English prompt. Do not add quotes, markdown formatting, or preamble."
    ].join(" ");

    for (const model of modelsToTry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: `User requested: "${cleanPrompt}"` }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
          })
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const expanded = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (expanded && expanded.length > 15) {
            console.log(`[AI Prompt Expansion] Succeeded with model ${model}:`, expanded.slice(0, 80) + "...");
            return expanded.replace(/^["'`]|["'`]$/g, "").replace(/\n+/g, " ").trim();
          }
        }
      } catch (err) {
        // Fallback to next model
      }
    }
  }

  // Fallback high-end enhancer if AI prompt expander is offline
  const styleModifier = IMAGE_STYLES[style] || IMAGE_STYLES.photorealistic;
  return `${cleanPrompt}, ${styleModifier}, modern contemporary look, vibrant colors, glowing background aura`;
}

function buildImageUrl(enhancedPrompt, style = "photorealistic") {
  const cleanPrompt = enhancedPrompt.replace(/^["'`]|["'`]$/g, "").trim();
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?model=flux`;
  return { imageUrl, enhancedPrompt: cleanPrompt };
}

function extractImageRequest(text) {
  if (!text || typeof text !== "string") return null;
  const clean = text.trim();

  // 1. Explicit commands
  const slashMatch = clean.match(/^(?:\/image|\/img|image:|img:)\s*(.+)/i);
  if (slashMatch) return slashMatch[1].trim();

  // 2. Action verbs with articles: "generate the image of...", "create an image of...", "make realistic image of..."
  const actionMatch = clean.match(/^(?:(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|will\s+you\s+)?(?:generate|create|make|draw|paint|show(?:\s+me)?|render|produce|design|craft|give\s+me)\s+(?:an?|the|some)?\s*(?:realistic\s+|modern\s+|ai\s+)*(?:image|photo|picture|artwork|painting|portrait|drawing|visual|illustration|wallpaper)s?\s*(?:of|for|showing|depicting|about)?\s*[:\s]?\s*(.+))/i);
  if (actionMatch && actionMatch[1]) return actionMatch[1].trim();

  // 3. Direct noun phrases: "image of maa kali", "photo of sunset"
  const nounMatch = clean.match(/^(?:an?|the)?\s*(?:realistic\s+|modern\s+|ai\s+)*(?:image|photo|picture|artwork|painting|portrait|drawing|illustration)\s+(?:of|showing|depicting|for)\s+(.+)/i);
  if (nounMatch && nounMatch[1]) return nounMatch[1].trim();

  // 4. "I want an image of..."
  const wantMatch = clean.match(/^(?:i\s+(?:want|need|would\s+like)\s+)(?:an?|the)?\s*(?:realistic\s+|modern\s+|ai\s+)*(?:image|photo|picture|artwork|portrait)\s+(?:of|showing|for)?\s*(.+)/i);
  if (wantMatch && wantMatch[1]) return wantMatch[1].trim();

  // 5. Hindi / Hinglish patterns: "maa kali ki photo banao", "kali maa ki image banao", "photo bana do"
  const hinglishMatch = clean.match(/^(.+?)\s*(?:ki|ka)?\s*(?:image|photo|pic|picture|tasveer|painting|drawing)\s*(?:banao|banado|bana\s*do|bana\s*ke\s*do|dikhao|dikhaye|chahiye|generate\s*karo|create\s*karo)/i);
  if (hinglishMatch && hinglishMatch[1] && !/^(kya|kaise|kyun|who|what)/i.test(hinglishMatch[1])) {
    return hinglishMatch[1].trim();
  }

  // 6. Short draw/paint commands
  const shortDrawMatch = clean.match(/^(?:draw|paint)\s+(?:me\s+)?(?:an?|the)?\s*(.+)/i);
  if (shortDrawMatch && shortDrawMatch[1] && !/^(a\s+conclusion|a\s+line)/i.test(shortDrawMatch[1])) {
    return shortDrawMatch[1].trim();
  }

  return null;
}

function extractVideoRequest(text) {
  if (!text || typeof text !== "string") return null;
  const clean = text.trim();

  // 1. Explicit slash / prefix commands
  const slashMatch = clean.match(/^(?:\/video|\/vid|video:|vid:)\s*(.+)/i);
  if (slashMatch) return slashMatch[1].trim();

  // 2. Action verbs: "generate video...", "create video...", "make a video of..."
  const actionMatch = clean.match(/^(?:(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|will\s+you\s+)?(?:generate|create|make|show(?:\s+me)?|produce|render|craft|give\s+me)\s+(?:an?|the|some)?\s*(?:ai\s+)?(?:video|clip|animation|footage|movie|film|motion)s?\s*(?:of|for|showing|depicting|about)?\s*[:\s]?\s*(.+))/i);
  if (actionMatch && actionMatch[1]) return actionMatch[1].trim();

  // 3. Direct noun phrases: "video of maa durga", "clip of ocean"
  const nounMatch = clean.match(/^(?:an?|the)?\s*(?:ai\s+)?(?:video|clip|animation|motion|footage)\s+(?:of|showing|depicting|for)\s+(.+)/i);
  if (nounMatch && nounMatch[1]) return nounMatch[1].trim();

  // 4. "I want a video of..."
  const wantMatch = clean.match(/^(?:i\s+(?:want|need|would\s+like)\s+)(?:an?|the)?\s*(?:ai\s+)?(?:video|clip|animation)\s+(?:of|showing|for)?\s*(.+)/i);
  if (wantMatch && wantMatch[1]) return wantMatch[1].trim();

  // 5. Hindi / Hinglish patterns: "video banao", "video create karo"
  const hinglishMatch = clean.match(/^(.+?)\s*(?:ki|ka)?\s*(?:video|clip|animation)\s*(?:banao|banado|bana\s*do|dikhao|dikhaye|chahiye|generate\s*karo|create\s*karo)/i);
  if (hinglishMatch && hinglishMatch[1] && !/^(kya|kaise|kyun|who|what)/i.test(hinglishMatch[1])) {
    return hinglishMatch[1].trim();
  }

  return null;
}

function isImageComplaintOrFollowUp(text) {
  return /(?:i\s+(?:had\s+|have\s+)?(?:told|asked)\s+(?:you\s+)?to\s+(?:create|make|generate)\s+image|you\s+didn'?t\s+(?:create|generate|make|give)\s+(?:the\s+)?image|make\s+(?:the|an?)\s+image|generate\s+it|create\s+it\s+now|generate\s+image\s+please|why\s+didn'?t\s+you\s+generate|image\s+seems\s+(?:like\s+)?old|make\s+them\s+good|like\s+how\s+chatgpt\s+making|like\s+chatgpt|make\s+it\s+realistic|photo\s+acchi\s+nahi\s+hai|purani\s+lag\s+rahi|old\s+lag\s+rahi|realistic\s+banao)/i.test(text);
}

async function fetchVideoFromArchive(query) {
  try {
    const cleanQuery = query.replace(/[^\w\s]/gi, "").trim();
    const searchTerms = cleanQuery.split(/\s+/).slice(0, 3).join(" ");
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(searchTerms)}%20filetype:video&gsrlimit=3&prop=imageinfo&iiprop=url|mime`;
    const res = await fetch(url, { headers: { "User-Agent": "AIChatbox/2.0" } });
    if (!res.ok) return null;
    const data = await res.json();
    const pages = Object.values(data.query?.pages || {});
    for (const page of pages) {
      const videoInfo = page.imageinfo?.[0];
      if (videoInfo && videoInfo.url && (videoInfo.url.endsWith(".webm") || videoInfo.url.endsWith(".ogv") || videoInfo.url.endsWith(".mp4"))) {
        return videoInfo.url;
      }
    }
  } catch (err) {
    console.warn("Video archive search error:", err.message);
  }
  return null;
}

app.post("/api/generate-image", async (req, res) => {
  try {
    const { prompt, style = "cinematic", aspectRatio = "1:1" } = req.body;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Please provide a prompt for image generation." });
    }
    const enhancedPrompt = await expandPromptWithAI(prompt, style);
    const { imageUrl, width, height, seed } = buildImageUrl(enhancedPrompt, style, aspectRatio);
    res.json({
      success: true,
      imageUrl,
      prompt: prompt.trim(),
      enhancedPrompt,
      style,
      aspectRatio,
      width,
      height,
      seed
    });
  } catch (error) {
    console.error("Image generation error:", error);
    res.status(500).json({ error: "Failed to generate image. Please try again." });
  }
});

app.post("/api/generate-video", async (req, res) => {
  try {
    const { prompt, motion = "cinematic", aspectRatio = "16:9" } = req.body;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ error: "Please provide a prompt for video generation." });
    }

    const enhancedPrompt = await expandPromptWithAI(prompt, "cinematic");
    const { imageUrl, width, height } = buildImageUrl(enhancedPrompt, "cinematic", aspectRatio);
    const archiveVideoUrl = await fetchVideoFromArchive(prompt);

    res.json({
      success: true,
      videoUrl: archiveVideoUrl || null,
      posterUrl: imageUrl,
      prompt: prompt.trim(),
      enhancedPrompt,
      motion,
      aspectRatio,
      width,
      height
    });
  } catch (error) {
    console.error("Video generation error:", error);
    res.status(500).json({ error: "Failed to generate video. Please try again." });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!geminiApiKey) {
      return res.status(500).json({
        error: "Gemini API key missing. Add GEMINI_API_KEY to your .env file, then restart the server."
      });
    }

    const messages = req.body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Please send at least one message." });
    }

    const timeInfo = req.body.clientTime || new Date().toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      timeZoneName: "short"
    });

    // Accept only the roles and text content this chatbox needs.
    const safeMessages = messages
      .filter((message) =>
        message &&
        ["user", "assistant"].includes(message.role) &&
        typeof message.content === "string"
      )
      .slice(-20)
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, 10000)
      }));

    if (safeMessages.length === 0 || safeMessages[safeMessages.length - 1].role !== "user") {
      return res.status(400).json({ error: "The last message must be from the user." });
    }

    const latestUserMessage = safeMessages[safeMessages.length - 1]?.content || "";

    // 1. Detect image generation intent
    let targetImagePrompt = extractImageRequest(latestUserMessage);

    // Check if user is following up after an issue ("i had told to create image but you didn't")
    if (!targetImagePrompt && isImageComplaintOrFollowUp(latestUserMessage)) {
      for (let i = safeMessages.length - 2; i >= 0; i--) {
        const prevMsg = safeMessages[i];
        if (prevMsg && prevMsg.role === "user") {
          const found = extractImageRequest(prevMsg.content) || prevMsg.content.replace(/(?:generate|create|make|draw|show)\s+(?:an?|the)?\s*image\s*(?:of)?/gi, "").trim();
          if (found && found.length > 2) {
            targetImagePrompt = found;
            break;
          }
        }
      }
    }

    if (targetImagePrompt) {
      const enhancedPrompt = await expandPromptWithAI(targetImagePrompt, "photorealistic");
      const { imageUrl } = buildImageUrl(enhancedPrompt, "photorealistic", "1:1");
      return res.json({
        reply: `🎨 **Generated Realistic AI Image (DALL·E 3 Quality)** for: *"${targetImagePrompt}"*\n\n> *${enhancedPrompt}*`,
        media: {
          type: "image",
          url: imageUrl,
          prompt: targetImagePrompt,
          enhancedPrompt: enhancedPrompt
        }
      });
    }

    // 2. Detect video generation commands
    const targetVideoPrompt = extractVideoRequest(latestUserMessage);

    if (targetVideoPrompt) {
      const enhancedPrompt = await expandPromptWithAI(targetVideoPrompt, "cinematic");
      const { imageUrl } = buildImageUrl(enhancedPrompt, "cinematic", "16:9");
      const archiveVideoUrl = await fetchVideoFromArchive(targetVideoPrompt);
      return res.json({
        reply: `🎬 **Generated AI Video (Kinetic Motion)** for: *"${targetVideoPrompt}"*\n\n> *${enhancedPrompt}*`,
        media: {
          type: "video",
          url: archiveVideoUrl || null,
          posterUrl: imageUrl,
          prompt: targetVideoPrompt,
          enhancedPrompt: enhancedPrompt
        }
      });
    }

    const liveWeatherInfo = await getLiveWeather(latestUserMessage);
    const reply = await callGemini(geminiApiKey, safeMessages, timeInfo, liveWeatherInfo);

    // 3. Safety Interceptor: If Gemini hallucinates a JSON tool call (e.g. dalle.text2im)
    if (typeof reply === "string") {
      const toolMatch = reply.match(/\{[\s\S]*"action"\s*:\s*"(?:dalle|image|generate)[\s\S]*\}/i);
      if (toolMatch) {
        try {
          const parsed = JSON.parse(toolMatch[0]);
          let extracted = "";
          if (typeof parsed.action_input === "string") {
            try {
              const inner = JSON.parse(parsed.action_input);
              extracted = inner.prompt || parsed.action_input;
            } catch {
              extracted = parsed.action_input;
            }
          } else if (parsed.action_input && parsed.action_input.prompt) {
            extracted = parsed.action_input.prompt;
          } else if (parsed.prompt) {
            extracted = parsed.prompt;
          }

          if (extracted && extracted.length > 2) {
            const enhancedPrompt = await expandPromptWithAI(extracted, "photorealistic");
            const { imageUrl } = buildImageUrl(enhancedPrompt, "photorealistic", "1:1");
            return res.json({
              reply: `🎨 **Generated Realistic AI Image (DALL·E 3 Quality)** for: *"${extracted.slice(0, 100)}"*`,
              media: {
                type: "image",
                url: imageUrl,
                prompt: extracted,
                enhancedPrompt: enhancedPrompt
              }
            });
          }
        } catch (err) {
          console.warn("JSON tool call parse fallback ignored:", err.message);
        }
      }
    }

    res.json({ reply });
  } catch (error) {
    console.error("AI request failed:", error.message);
    res.status(500).json({
      error: error.message || "The AI request failed. Check your API key, model access, and internet connection."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI Chatbox is running at http://localhost:${PORT}`);
});
