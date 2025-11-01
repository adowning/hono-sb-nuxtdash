import App from './App.vue'
import { createApp } from 'vue'
import { initStore } from './store' // Store
import { initRouter } from './router' // Router
import language from './locales' // Internationalization
import '@styles/reset.scss' // Reset HTML style
import '@styles/app.scss' // Global styles
import '@styles/el-ui.scss' // Optimize Element style
import '@styles/mobile.scss' // Mobile style optimization
import '@styles/change.scss' // Theme switching transition optimization
import '@styles/theme-animation.scss' // theme switching animation
import '@styles/el-dark.scss' // Element dark theme
import '@styles/dark.scss' // system theme
import '@icons/system/iconfont.css' // System icon
import '@utils/sys/console.ts' //Console output content
import { setupGlobDirectives } from './directives'
import { setupErrorHandle } from './utils/sys/error-handle'

document.addEventListener(
  'touchstart',
  function () {},
  { passive: false }
)

const app = createApp(App)
initStore(app)
initRouter(app)
setupGlobDirectives(app)
setupErrorHandle(app)

app.use(language)
app.mount('#app')