import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerTelegramRoutes, startTelegramPolling } from './server/telegramService';
import { registerEmailRoutes } from './server/emailService';
import { registerDepositGatewayRoutes } from './server/depositGatewayService';
import {
  registerErrorTelemetryRoutes,
  initializeProcessErrorGuards,
  runSystemSelfHealing,
} from './server/errorTelemetryService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Attach global process guards for unhandled exceptions
initializeProcessErrorGuards();

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Run startup self-healing audit
  try {
    const healReport = runSystemSelfHealing();
    console.log('[Self-Healing Startup]', healReport.status, healReport.actionsTaken);
  } catch (healErr) {
    console.warn('[Self-Healing Startup Error]', healErr);
  }

  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    })
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'CaptchaPay Bangladesh' });
  });

  registerTelegramRoutes(app);
  registerEmailRoutes(app);
  registerDepositGatewayRoutes(app);
  registerErrorTelemetryRoutes(app);
  startTelegramPolling();

  if (process.env.NODE_ENV === 'production') {
    app.use(
      express.static(path.resolve(__dirname, 'dist'), {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  } else {
    app.use((_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    });
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CaptchaPay Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
