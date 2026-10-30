
const http = require('node:http');

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';

  const originAllowed =
    ALLOWED_ORIGINS.includes('*') ||
    ALLOWED_ORIGINS.includes(origin);

  if (originAllowed && origin) {
    res.setHeader(
      'Access-Control-Allow-Origin',
      ALLOWED_ORIGINS.includes('*') ? '*' : origin
    );
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (!originAllowed) {
    return send(res, 403, {
      error: 'This website origin is not allowed.'
    });
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    return send(res, 200, {
      status: 'ok',
      service: 'Vaie AI Gemini backend',
      model: GEMINI_MODEL,
      configured: Boolean(GEMINI_API_KEY)
    });
  }

  if (req.method !== 'POST' || req.url !== '/api/chat') {
    return send(res, 404, {
      error: 'Route not found. Use POST /api/chat.'
    });
  }

  if (!GEMINI_API_KEY) {
    return send(res, 503, {
      error: 'Missing GEMINI_API_KEY. Add your Google AI Studio key in Render Environment settings.'
    });
  }

  if (/[^\x00-\x7F]/.test(GEMINI_API_KEY + GEMINI_MODEL)) {
    return send(res, 500, {
      error: 'The Gemini key or model contains invalid characters. Check Render Environment settings.'
    });
  }

  try {
    const body = await readJson(req, 100_000);

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return send(res, 400, {
        error: 'Send a non-empty messages array.'
      });
    }

    const messages = body.messages.slice(-20).map(item => {
      if (
        !item ||
        !['user', 'assistant'].includes(item.role) ||
        typeof item.content !== 'string'
      ) {
        throw new Error(
          'Each message needs a user/assistant role and text content.'
        );
      }

      return {
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.content.slice(0, 12000) }]
      };
    });

    if (!messages.some(message => message.role === 'user')) {
      return send(res, 400, {
        error: 'At least one user message is required.'
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: 'You are Vaie AI, a helpful, clear, and honest assistant. If you are uncertain, say so. Never claim to have searched the web or accessed files unless a tool actually did so.'
            }]
          },
          contents: messages,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1200
          }
        }),
        signal: AbortSignal.timeout(60000)
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        result?.error?.message ||
        `Google Gemini returned HTTP ${response.status}.`;

      console.error('Gemini request failed:', response.status, message);

      return send(res, response.status === 429 ? 429 : 502, {
        error: message
      });
    }

    const answer = result?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('');

    if (typeof answer !== 'string' || !answer.trim()) {
      console.error('Gemini returned no text answer.');
      return send(res, 502, {
        error: 'Gemini returned an empty answer.'
      });
    }

    return send(res, 200, {
      answer: answer.trim()
    });

  } catch (error) {
    if (error.message === 'Request body too large') {
      return send(res, 413, { error: 'Request is too large.' });
    }

    if (error instanceof SyntaxError) {
      return send(res, 400, { error: 'Invalid JSON request body.' });
    }

    if (
      error.name === 'AbortError' ||
      error.name === 'TimeoutError'
    ) {
      return send(res, 504, {
        error: 'Gemini took too long to respond. Please try again.'
      });
    }

    if (error.message?.startsWith('Each message')) {
      return send(res, 400, { error: error.message });
    }

    console.error('Chat request failed:', error.stack || error.message);

    return send(res, 500, {
      error: 'Vaie AI could not complete the request. Check backend logs.'
    });
  }
});

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;

    req.setEncoding('utf8');

    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);

      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }

      data += chunk;
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

function send(res, status, data) {
  if (res.destroyed || res.writableEnded) return;

  res.writeHead(status);
  res.end(JSON.stringify(data));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Vaie AI Gemini backend listening on port ${PORT}`);
});

