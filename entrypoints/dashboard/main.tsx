import React from 'react';
import ReactDOM from 'react-dom/client';
import { DashboardApp } from './DashboardApp';
import { initPageAppearance } from '../../src/ui/theme/appearance';
import '../../src/ui/shared.css';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('复习面板根节点不存在');

// 渲染前先套上外观（主题色 + 浅/深色），避免首屏闪色
initPageAppearance();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <DashboardApp />
  </React.StrictMode>,
);
