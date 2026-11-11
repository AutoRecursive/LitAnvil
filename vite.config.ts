import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const runtimeDirectories = ['**/data/**','**/uploads/**','**/notes/**','**/logs/**'];
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {entries:['index.html']},
  server: {
    port:5173,
    watch:{ignored:runtimeDirectories},
    fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**',...runtimeDirectories]},
  },
});
