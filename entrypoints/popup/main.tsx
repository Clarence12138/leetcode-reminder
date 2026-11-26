import React from 'react';
import ReactDOM from 'react-dom/client';
import { PopupApp } from './PopupApp';
import { initPageAppearance } from '../../src/ui/theme/appearance';
import '../../src/ui/shared.css';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('弹窗根节点不存在');

// 渲染前先套上外观（主题色 + 浅/深色），避免首屏闪色
initPageAppearance();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
);
