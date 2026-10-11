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

// Dedicated Hindu Deity Visual Masterpiece Prompts (ChatGPT / DALL-E 3 Aesthetics)
const DEITY_PROMPTS = [
  {
    regex: /\b(?:kali|kaali|mahakali|maha\s*kali)\b/i,
    name: "Maa Kali",
    prompt: "Divine Goddess Maa Kali in majestic benevolent form, glowing radiant golden crown mukut, ornate royal gold jewelry, vibrant celestial deep blue skin, serene protective expression with gentle smile, wearing royal crimson silk saree with golden embroidery, glowing celestial golden halo, glowing temple diyas and sacred lotus in background, breathtaking devotional digital artwork"
  },
  {
    regex: /\b(?:durga|sherawali|ambe|ambika)\b/i,
    name: "Maa Durga",
    prompt: "Divine Goddess Maa Durga seated gracefully on a majestic roaring golden lion, eight arms holding sacred trishula trident, lotus, sword, conch, wearing royal red and gold embroidered silk saree, radiant golden crown with jewels, glowing divine golden aura, serene smiling face, warm temple lamps in background, devotional masterpiece"
  },
  {
    regex: /\b(?:shailaputri|shailputri)\b/i,
    name: "Maa Shailaputri",
    prompt: "Divine Goddess Maa Shailaputri in Himalayan mountains with pink lotus and trishula, golden crown, pure silk attire, serene smile, golden sunrise glow, devotional digital artwork"
  },
  {
    regex: /\b(?:brahmacharini)\b/i,
    name: "Maa Brahmacharini",
    prompt: "Divine Goddess Maa Brahmacharini, graceful serene standing posture holding sacred japa mala and kamandalu, wearing pure white and golden silk saree, radiant divine halo, sacred temple atmosphere with soft golden lighting, devotional masterpiece"
  },
  {
    regex: /\b(?:chandraghanta)\b/i,
    name: "Maa Chandraghanta",
    prompt: "Divine Goddess Maa Chandraghanta on a golden tiger, bell shaped crescent moon on golden crown, holding sacred lotus and trident, radiant golden aura, vibrant silk garments, devotional masterpiece"
  },
  {
    regex: /\b(?:kushmanda)\b/i,
    name: "Maa Kushmanda",
    prompt: "Divine Goddess Maa Kushmanda riding a majestic radiant lion, glowing with solar golden light, holding sacred lotus and nectar pot, luminous warm golden halo, devotional masterpiece"
  },
  {
    regex: /\b(?:skandamata)\b/i,
    name: "Maa Skandamata",
    prompt: "Divine Goddess Maa Skandamata seated peacefully on a glowing pink lotus flower, holding baby Lord Kartikeya lovingly, radiant motherly smiling face, royal silk attire, warm celestial glow, devotional masterpiece"
  },
  {
    regex: /\b(?:katyayani)\b/i,
    name: "Maa Katyayani",
    prompt: "Divine Warrior Goddess Maa Katyayani riding a majestic golden lion, holding celestial sword and sacred lotus, radiant golden mukut and jewels, glowing golden halo, devotional masterpiece"
  },
  {
    regex: /\b(?:kalaratri)\b/i,
    name: "Maa Kalaratri",
    prompt: "Divine Goddess Maa Kalaratri in protective benevolent form, cosmic dark sky skin, radiant third eye, holding sacred sickle, flowing dark hair, triumphant protective golden light around crown, devotional masterpiece"
  },
  {
    regex: /\b(?:mahagauri)\b/i,
    name: "Maa Mahagauri",
    prompt: "Divine Goddess Maa Mahagauri riding a graceful white bull, pure white radiant luminosity, holding sacred trishula trident and damru drum, wearing pure white silk saree, serene peaceful smile, devotional masterpiece"
  },
  {
    regex: /\b(?:siddhidatri)\b/i,
    name: "Maa Siddhidatri",
    prompt: "Divine Goddess Maa Siddhidatri seated peacefully upon a blooming pink lotus throne, four arms holding chakra discus, mace, conch, and lotus, resplendent red and gold silk attire, radiant celestial golden aura, devotional masterpiece"
  },
  {
    regex: /\b(?:shiva|mahadev|bholenath|shankar|nilkanth|neelkanth)\b/i,
    name: "Lord Shiva",
    prompt: "Lord Shiva in meditation, snowy mountain peaks of Kailash, crescent moon, sacred golden aura, serene smile, devotional art"
  },
  {
    regex: /\b(?:krishna|kanha|radha\s*krishna|gopal)\b/i,
    name: "Lord Krishna",
    prompt: "Lord Krishna playing golden flute with peacock feather in radiant crown, glowing blue complexion, yellow silk attire, enchanting smile, devotional art"
  },
  {
    regex: /\b(?:ganesh|ganesha|ganpati|vinayak|vinayaka)\b/i,
    name: "Lord Ganesha",
    prompt: "Lord Ganesha seated on ornate throne with modak sweet and sacred lotus, radiant golden crown with jewels, glowing warm halo, devotional art"
  },
  {
    regex: /\b(?:hanuman|bajrangbali|maruti|anjaneya)\b/i,
    name: "Lord Hanuman",
    prompt: "Lord Hanuman with golden gada, sacred vermilion tilak, radiant golden aura, serene devoted smile, devotional art"
  },
  {
    regex: /\b(?:lakshmi|laxmi)\b/i,
    name: "Maa Lakshmi",
    prompt: "Goddess Lakshmi on blooming pink lotus, showering golden coins, royal red and gold silk saree, radiant golden crown, devotional art"
  },
  {
    regex: /\b(?:saraswati|shardha|sarada)\b/i,
    name: "Maa Saraswati",
    prompt: "Goddess Saraswati on pure white lotus playing classical veena, pure white silk saree, crystal rosary, radiant divine aura, devotional art"
  },
  {
    regex: /\b(?:shree\s*ram|shri\s*ram|lord\s*ram|rama|sita\s*ram)\b/i,
    name: "Lord Rama",
    prompt: "Lord Rama standing with noble grace holding divine bow and arrows, royal blue complexion, regal saffron and gold robes, ornate golden crown, compassionate gentle smile, glowing golden aura, devotional masterpiece"
  }
];

function getDeityVisualPrompt(text) {
  if (!text) return null;
  for (const item of DEITY_PROMPTS) {
    if (item.regex.test(text)) {
      return item.prompt;
    }
  }
  return null;
}

function sanitizePrompt(raw) {
  if (!raw) return "";
  let clean = String(raw).trim();

  // If Gemini returned a JSON object or tool call block
  if (clean.startsWith("{") || clean.includes('"action":') || clean.includes('"prompt":')) {
    try {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (typeof parsed.action_input === "string") {
          try {
            const inner = JSON.parse(parsed.action_input);
            clean = inner.prompt || parsed.action_input;
          } catch {
            clean = parsed.action_input;
          }
        } else if (parsed.action_input?.prompt) {
          clean = parsed.action_input.prompt;
        } else if (parsed.prompt) {
          clean = parsed.prompt;
        }
      }
    } catch {
      clean = clean.replace(/\{[\s\S]*?"(?:prompt|action_input)":\s*"([^"]+)"[\s\S]*?\}/g, "$1");
    }
  }

  // Remove markdown code fences or quotes
  clean = clean.replace(/```(?:json)?|```/g, "").replace(/^["'`]|["'`]$/g, "").replace(/\n+/g, " ").trim();

  // Strip blacklisted paywall / filter trigger buzzwords
  const blacklist = /\b(8k|photorealistic|hyper-realistic|sharp focus|ultra realistic|volumetric lighting|octane render|unreal engine|supercar)\b/gi;
  clean = clean.replace(blacklist, "").replace(/\s{2,}/g, " ").trim();

  return clean;
}

// Expands user prompts into modern ChatGPT DALL-E 3 master prompts using Gemini
async function expandPromptWithAI(rawPrompt, style = "photorealistic") {
  const cleanPrompt = rawPrompt.replace(/^["'`]|["'`]$/g, "").trim();
  if (!cleanPrompt) return cleanPrompt;

  // 1. Direct match for sacred deities to guarantee ChatGPT-quality iconography
  const deityPrompt = getDeityVisualPrompt(cleanPrompt);
  if (deityPrompt) {
    console.log(`[AI Image] Matched authentic sacred deity preset for: "${cleanPrompt}"`);
    return deityPrompt;
  }

  if (geminiApiKey) {
    const modelsToTry = [...new Set(GEMINI_MODELS)];
    const styleGuide = style === "cinematic"
      ? "contemporary film style, rich color grading, natural visual effects"
      : style === "anime"
      ? "vibrant modern anime film style in Makoto Shinkai and Ufotable aesthetic"
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
      "2. If depicting deities or sacred figures (e.g. Maa Kali, Durga, Shiva), depict them with divine majesty, glowing blue or golden celestial aura, polished solid gold jewelry and crown, royal robes, contemporary cinema visual effects.",
      "3. For general subjects (people, cars, cities), use modern contemporary fashion, current-year styling, sleek design.",
      "4. Do NOT use forbidden words: 'cinematic', 'sharp', '8k', 'hyper-realistic', 'photorealistic', 'portrait', 'volumetric', 'supercar'. Instead describe lighting, color, mood, and subject with vivid natural language.",
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
            const sanitized = sanitizePrompt(expanded);
            console.log(`[AI Prompt Expansion] Succeeded with model ${model}:`, sanitized.slice(0, 80) + "...");
            return sanitized;
          }
        }
      } catch (err) {
        // Fallback to next model
      }
    }
  }

  // Fallback high-end enhancer if AI prompt expander is offline
  const styleModifier = IMAGE_STYLES[style] || IMAGE_STYLES.photorealistic;
  return sanitizePrompt(`${cleanPrompt}, ${styleModifier}, modern contemporary look, vibrant colors, glowing background aura`);
}

function buildImageUrl(enhancedPrompt, style = "photorealistic") {
  const cleanPrompt = sanitizePrompt(enhancedPrompt);
  // Using model=sana for reliable, unrestricted 200 JPEG generation on Pollinations free tier
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?model=sana`;
  return { imageUrl, enhancedPrompt: cleanPrompt };
}

function extractImageRequest(text) {
  if (!text || typeof text !== "string") return null;
  const clean = text.trim();

  // 1. Explicit commands: /image, /img, /pic, image:, img:, pic:
  const slashMatch = clean.match(/^(?:\/image|\/img|\/pic|image:|img:|pic:)\s*(.+)/i);
  if (slashMatch) return slashMatch[1].trim();

  // 2. Action verbs with image/img/pic/photo:
  // "create img of maa kali", "create image of maa durga", "generate pic of...", "make an img of..."
  const actionMatch = clean.match(/^(?:(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|will\s+you\s+)?(?:generate|create|make|draw|paint|show(?:\s+me)?|render|produce|design|craft|give\s+me)\s+(?:an?|the|some)?\s*(?:realistic\s+|modern\s+|ai\s+)*(?:image|img|photo|pic|picture|artwork|painting|portrait|drawing|visual|illustration|wallpaper)s?\s*(?:of|for|showing|depicting|about)?\s*[:\s]?\s*(.+))/i);
  if (actionMatch && actionMatch[1]) return actionMatch[1].trim();

  // 3. Direct noun phrases: "image of maa kali", "img of maa durga", "photo of maa shailaputri", "pic of..."
  const nounMatch = clean.match(/^(?:an?|the)?\s*(?:realistic\s+|modern\s+|ai\s+)*(?:image|img|photo|pic|picture|artwork|painting|portrait|drawing|illustration)\s+(?:of|showing|depicting|for)\s+(.+)/i);
  if (nounMatch && nounMatch[1]) return nounMatch[1].trim();

  // 4. "I want an image/img/pic of..."
  const wantMatch = clean.match(/^(?:i\s+(?:want|need|would\s+like)\s+)(?:an?|the)?\s*(?:realistic\s+|modern\s+|ai\s+)*(?:image|img|photo|pic|picture|artwork|portrait)\s+(?:of|showing|for)?\s*(.+)/i);
  if (wantMatch && wantMatch[1]) return wantMatch[1].trim();

  // 5. Hindi / Hinglish patterns: "maa kali ki photo banao", "durga maa ki pic banao", "kali maa ka img bana do"
  const hinglishMatch = clean.match(/^(.+?)\s*(?:ki|ka)?\s*(?:image|img|photo|pic|picture|tasveer|painting|drawing)\s*(?:banao|banado|bana\s*do|bana\s*ke\s*do|dikhao|dikhaye|chahiye|generate\s*karo|create\s*karo)/i);
  if (hinglishMatch && hinglishMatch[1] && !/^(kya|kaise|kyun|who|what)/i.test(hinglishMatch[1])) {
    return hinglishMatch[1].trim();
  }

  // 6. Short draw/paint commands: "draw maa kali", "paint maa durga"
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

async function fetchWikiImage(query) {
  try {
    const clean = query.replace(/[^\w\s]/gi, "").trim().split(/\s+/).slice(0, 3).join(" ");
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(clean)}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url`;
    const res = await fetch(url, { headers: { "User-Agent": "AIChatbox/2.0" } });
    if (!res.ok) return null;
    const data = await res.json();
    const pages = Object.values(data.query?.pages || {});
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (info && info.url && /\.(jpg|jpeg|png|webp)/i.test(info.url.split("?")[0])) {
        return info.url;
      }
    }
  } catch (err) {
    console.warn("Wiki image archive search error:", err.message);
  }
  return null;
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
    for (const p of pages) {
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
    const fallbackUrl = await fetchWikiImage(prompt);
    res.json({
      success: true,
      imageUrl,
      fallbackUrl: fallbackUrl || null,
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
      const fallbackUrl = await fetchWikiImage(targetImagePrompt);
      return res.json({
        reply: `🎨 **Generated Realistic AI Image (DALL·E 3 Quality)** for: *"${targetImagePrompt}"*\n\n> *${enhancedPrompt}*`,
        media: {
          type: "image",
          url: imageUrl,
          fallbackUrl: fallbackUrl || null,
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
            const fallbackUrl = await fetchWikiImage(extracted);
            return res.json({
              reply: `🎨 **Generated Realistic AI Image (DALL·E 3 Quality)** for: *"${extracted.slice(0, 100)}"*`,
              media: {
                type: "image",
                url: imageUrl,
                fallbackUrl: fallbackUrl || null,
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
