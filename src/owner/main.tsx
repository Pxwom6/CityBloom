/** The owner area's page (`owner.html`, phase 6): no 3D, no sim, just the owner's lists. */
import { render, h } from 'preact';
import '../ui/styles/tokens.css';
import './owner.css';
import { OwnerApp } from './OwnerApp';

const relay = (import.meta.env.VITE_RELAY_URL as string | undefined)?.trim() || null;
const base = relay ? relay.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '') : null;

render(h(OwnerApp, { base }), document.getElementById('owner')!);
