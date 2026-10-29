
const http = require('node:http');

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

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
      service: 'Vaie AI backend',
      model: OPENAI_MODEL,
      configured: Boolean(OPENAI_API_KEY)
    });
  }

  if (req.method !== 'POST' || req.url !== '/api/chat') {
    return send(res, 404, {
      error: 'Route not found. Use POST /api/chat.'
    });
  }

  if (!OPENAI_API_KEY) {
    return send(res, 503, {
      error: 'The backend is missing OPENAI_API_KEY. Add it in Render Environment settings.'
    });
  }

  // Diagnose invalid characters without exposing secret values.
  if (/[^\x00-\x7F]/.test(OPENAI_API_KEY)) {
    console.error('OPENAI_API_KEY contains non-ASCII characters.');
    return send(res, 500, {
      error: 'The API key in Render contains invalid characters. Re-enter your API key in Environment settings.'
    });
  }

  if (/[^\x00-\x7F]/.test(OPENAI_MODEL)) {
    console.error('OPENAI_MODEL contains non-ASCII characters.');
    return send(res, 500, {
      error: 'The model setting contains invalid characters. Remove OPENAI_MODEL from Render Environment to use the default model.'
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
        role: item.role,
        content: item.content.slice(0, 12_000)
      };
    });

    if (!messages.some(message => message.role === 'user')) {
      return send(res, 400, {
        error: 'At least one user message is required.'
      });
    }

    const upstream = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You are Vaie AI, a helpful, clear, and honest assistant. If you are uncertain, say so. Never claim to have searched the web or accessed files unless a tool actually did so.'
            },
            ...messages
          ],
          temperature: 0.7,
          max_tokens: 1200
        }),
        signal: AbortSignal.timeout(60_000)
      }
    );

    const result = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const message =
        result?.error?.message ||
        `AI provider returned HTTP ${upstream.status}.`;

      console.error('OpenAI request failed with HTTP', upstream.status);

      const status =
        upstream.status === 429
          ? 429
          : upstream.status >= 500
            ? 502
            : 400;

      return send(res, status, { error: message });
    }

    const answer = result?.choices?.[0]?.message?.content;

    if (typeof answer !== 'string' || !answer.trim()) {
      console.error('OpenAI returned an empty answer.');
      return send(res, 502, {
        error: 'The AI provider returned an empty answer.'
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
        error: 'The AI service took too long. Please try again.'
      });
    }

    if (error.message?.startsWith('Each message')) {
      return send(res, 400, { error: error.message });
    }

    // Log the stack for diagnosis, but never log the API key.
    console.error(
      'Chat request failed:',
      error.stack || error.message
    );

    return send(res, 500, {
      error: 'The server could not complete the request. Check the backend logs.'
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
  console.log(`Vaie AI backend listening on port ${PORT}`);
});
