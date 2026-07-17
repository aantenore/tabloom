import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#root');
if (root === null) {
  throw new Error('The demo root element is missing.');
}

createRoot(root).render(<App />);
