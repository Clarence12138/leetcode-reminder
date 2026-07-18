import React from 'react';
import ReactDOM from 'react-dom/client';
import { DashboardApp } from './DashboardApp';
import '../../src/ui/shared.css';
import './style.css';
import './views.css';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('复习面板根节点不存在');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>,
);
