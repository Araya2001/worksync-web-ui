import {defineConfig, loadEnv} from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({command, mode}) => {
    // Load env file based on `mode` in the current working directory.
    const env = loadEnv(mode, process.cwd(), '')
    
    return {
        plugins: [react()],
        
        // Define global constants for environment variables
        define: {
            __APP_VERSION__: JSON.stringify(env.VITE_APP_VERSION || '1.0.0'),
            __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
        },
        
        server: {
            port: 5173,
            host: '0.0.0.0',
            allowedHosts: [
                'localhost',
                'stratos.a.pinggy.link'
            ],
            cors: env.VITE_DEV_CORS_ENABLED === 'true' ? {
                origin: [
                    'http://localhost:5173',
                    'https://stratos.a.pinggy.link',
                    'http://stratos.a.pinggy.link'
                ],
                credentials: true
            } : false,
            
            // Conditional proxy based on environment
            proxy: env.VITE_DEV_PROXY_ENABLED === 'true' ? {
                '/api': {
                    target: env.VITE_API_URL || 'https://worksync-integration-handler-625943711296.europe-west1.run.app',
                    changeOrigin: true,
                    secure: true,
                    configure: (proxy) => {
                        proxy.on('error', (err) => {
                            if (env.VITE_ENABLE_DEBUG_LOGGING === 'true') {
                                console.log('proxy error', err);
                            }
                        });
                        
                        if (env.VITE_ENABLE_DEBUG_LOGGING === 'true') {
                            proxy.on('proxyReq', (proxyReq, req) => {
                                console.log('Sending Request to the Target:', req.method, req.url);
                            });
                            proxy.on('proxyRes', (proxyRes, req) => {
                                console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
                            });
                        }
                    }
                }
            } : {}
        },
        
        build: {
            // Build optimizations
            rollupOptions: {
                output: {
                    manualChunks: {
                        vendor: ['react', 'react-dom'],
                        utils: ['./src/services/api.js', './src/services/tokenStorage.js']
                    }
                }
            },
            // Source maps for production debugging
            sourcemap: env.VITE_ENVIRONMENT === 'development'
        }
    }
})