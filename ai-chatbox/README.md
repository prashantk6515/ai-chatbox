# AI Chatbox (beginner project)

A simple ChatGPT-style chat interface built with HTML, CSS, JavaScript, Node.js, Express, and the OpenAI API.

## Requirements

- Node.js (LTS)
- An OpenAI API key with API access and available billing/usage
- Internet connection

## Setup on Windows

1. Extract the project ZIP.
2. Open the `ai-chatbox` folder in VS Code.
3. Open Terminal > New Terminal.
4. Install dependencies:

   ```powershell
   npm install
   ```

5. Copy `.env.example` to a new file named `.env`.
6. Open `.env` and replace `put_your_api_key_here` with your API key. Do not share this file or put your key in `public/script.js`.
7. Start the server:

   ```powershell
   npm start
   ```

8. Open http://localhost:3000 in your browser.

## Important

- Open the app through `http://localhost:3000`, not by double-clicking `index.html`. The frontend calls the local backend.
- API usage may cost money. Check the provider's current pricing and usage limits.
- The conversation is stored in browser memory only and is lost when you reset or reload the page.
- This is a learning project, not a production-hardened public service. Before deploying publicly, add authentication, rate limiting, request-size controls, monitoring, and stronger abuse protections.
