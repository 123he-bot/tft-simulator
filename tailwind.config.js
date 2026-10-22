/** TailwindCSS 配置：与 css/style.css 中的设计令牌保持一致 */
module.exports = {
  darkMode: 'class',
  content: [
    '/workspace/jinchanchan-simulator/index.html',
    '/workspace/jinchanchan-simulator/js/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        bg: '#060911', bg2: '#080d18',
        surface: '#0d1424', surface2: '#121b30', surface3: '#18233c', surface4: '#1e2b48',
        line: '#22304d', line2: '#33456b',
        ink: '#e8f0ff', dim: '#93a4c4', mute: '#61708f',
        cyanx: '#22d3ee', goldx: '#f5c542', magentax: '#f43f5e', violetx: '#8b5cf6',
        greenx: '#34d399', orangex: '#fb923c'
      },
      borderRadius: { sm2: '8px', md2: '12px', lg2: '16px' },
      fontSize: { xxs: '10px' }
    }
  },
  plugins: []
}
