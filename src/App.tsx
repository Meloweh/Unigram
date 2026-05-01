/**
 * App entry. Mounts the Omnigram (new) shell. Legacy prototype lives in
 * `src/old/` as reference only and is excluded from the build.
 */
import { OmnigramApp } from './app/OmnigramApp'
import './App.css'

function App() {
  return <OmnigramApp />
}

export default App
