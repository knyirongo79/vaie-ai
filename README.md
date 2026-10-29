# Vaie AI — GitHub website + AI backend

This project has a static frontend (`index.html`) and a separate Node.js API (`backend/`). The frontend is designed to work on GitHub Pages. The backend source can be stored in GitHub, but **GitHub Pages cannot run Node.js server code**; deploy the `backend` folder to a Node.js host such as Render, then connect its URL to the frontend.

## What is included

- `index.html` — Vaie AI, white/light UI, V branding, saved local chat history.
- Full-screen conversation layout — sending a prompt hides the sidebar and expands the conversation to use the page; **New chat** returns to the home view.
- `backend/server.js` — Node.js API endpoint `POST /api/chat` and health endpoint `GET /api/health`.
- `backend/.env.example` — names of required environment variables; no real API key is included.

## 1. Put the website on GitHub Pages

1. Upload `index.html` to the root of your GitHub Pages repository (or copy its contents into your existing homepage file).
2. Enable GitHub Pages in the repository settings if it is not already enabled.

## 2. Deploy the backend

Example using Render:

1. Push this project to a GitHub repository.
2. In Render, create a **Web Service** from that repository.
3. Set **Root Directory** to `backend`.
4. Set **Runtime** to Node, **Build Command** to `npm install`, and **Start Command** to `npm start`.
5. Add environment variables in the host dashboard:
   - `OPENAI_API_KEY` = your private OpenAI API key
   - `OPENAI_MODEL` = `gpt-4o-mini` (or a model your account can use)
   - `ALLOWED_ORIGINS` = your exact GitHub Pages origin, e.g. `https://YOUR-GITHUB-USERNAME.github.io`
6. Deploy and copy the service URL, such as `https://your-service.onrender.com`.

Do not put your API key in `index.html`, commit it to GitHub, or share it in chat. API usage may cost money and requires an API account with billing/credits configured.

## 3. Connect the website to the backend

Open `index.html`, find:

```js
const API_BASE_URL = "https://YOUR-BACKEND-SERVICE.onrender.com";
```

Replace the example URL with your real backend service URL, without a trailing slash. Save and push the updated file to GitHub Pages.

## 4. Test it

- Visit `https://YOUR-BACKEND-SERVICE.onrender.com/api/health`. It should return JSON with `"status":"ok"`.
- Open your GitHub Pages website and ask Vaie AI a question.
- If it fails, check the backend logs and make sure the `ALLOWED_ORIGINS` value exactly matches the website origin.

## Notes

- This backend answers questions using the OpenAI API. It does not currently browse the web, inspect uploaded files, or generate images. Those features need additional integrations.
- The frontend can be opened locally for design preview, but live AI requests need the deployed backend URL.
- For a public website, consider adding authentication, rate limits, and usage monitoring before sharing widely.
