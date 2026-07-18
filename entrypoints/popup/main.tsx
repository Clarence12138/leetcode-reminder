import React from 'react';
import ReactDOM from 'react-dom/client';
import { PopupApp } from './PopupApp';
import '../../src/ui/shared.css';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('弹窗根节点不存在');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
);
