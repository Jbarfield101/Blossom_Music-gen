import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { SharedStateProvider } from './lib/sharedState.jsx';
import './App.css';
import '../theme.css';
import '../theme.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SharedStateProvider>
        <App />
      </SharedStateProvider>
    </HashRouter>
  </React.StrictMode>
);

