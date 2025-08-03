import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        host: '0.0.0.0',
        allowedHosts: [
            'localhost',
            'stratos.a.pinggy.link'
        ],
        cors: {
            origin: [
                'http://localhost:5173',
                'https://stratos.a.pinggy.link',
                'http://stratos.a.pinggy.link'
            ],
            credentials: true
        },
        proxy: {
            '/api': {
                target: 'https://worksync-integration-handler-625943711296.europe-west1.run.app',
                changeOrigin: true,
                secure: true,
                configure: (proxy) => {
                    proxy.on('error', (err) => {
                        console.log('proxy error', err);
                    });
                    proxy.on('proxyReq', (proxyReq, req) => {
                        console.log('Sending Request to the Target:', req.method, req.url);
                    });
                    proxy.on('proxyRes', (proxyRes, req) => {
                        console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
                    });
                }
            }
        }
    }
})