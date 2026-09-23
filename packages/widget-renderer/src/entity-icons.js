/**
 * Line icons for entities.
 *
 * Tiles, pinned tiles and the primary cards draw an entity's default icon as a Lucide-style stroke
 * icon (currentColor, round caps) instead of an emoji, so active tiles can tint and glow it with
 * the accent. Two sources still win over the line icon, in the same order as getEntityIcon():
 *   1. a custom icon the user picked for the entity (always an emoji or single glyph), and
 *   2. an explicit `mdi:` icon Home Assistant supplies, drawn with the bundled MDI font.
 * getEntityIcon() itself keeps returning emoji: notifications, alert lists and the settings
 * pickers need a plain string.
 *
 * Icon geometry is copied from Lucide (https://lucide.dev), ISC License,
 * Copyright (c) Lucide Icons and Contributors.
 */

import { getHomeAssistantMdiGlyph, normalizeEntityIconGlyph } from './utils.js';
import state from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LINE_ICON_STROKE_WIDTH = '1.75';

/** Lucide element lists, keyed by icon name: [tagName, attributes]. The entity icons come first;
 * the last few (settings … check) draw the window and Quick Access chrome. */
const LINE_ICONS = {
  lightbulb: [
    [
      'path',
      {
        d: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5',
      },
    ],
    ['path', { d: 'M9 18h6' }],
    ['path', { d: 'M10 22h4' }],
  ],
  plug: [
    ['path', { d: 'M12 22v-5' }],
    ['path', { d: 'M15 8V2' }],
    ['path', { d: 'M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z' }],
    ['path', { d: 'M9 8V2' }],
  ],
  'toggle-left': [
    ['circle', { cx: '9', cy: '12', r: '3' }],
    ['rect', { width: '20', height: '14', x: '2', y: '5', rx: '7' }],
  ],
  'toggle-right': [
    ['circle', { cx: '15', cy: '12', r: '3' }],
    ['rect', { width: '20', height: '14', x: '2', y: '5', rx: '7' }],
  ],
  fan: [
    [
      'path',
      {
        d: 'M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z',
      },
    ],
    ['path', { d: 'M12 12v.01' }],
  ],
  thermometer: [['path', { d: 'M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z' }]],
  droplet: [
    [
      'path',
      {
        d: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
      },
    ],
  ],
  droplets: [
    [
      'path',
      {
        d: 'M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z',
      },
    ],
    [
      'path',
      {
        d: 'M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97',
      },
    ],
  ],
  gauge: [
    ['path', { d: 'm12 14 4-4' }],
    ['path', { d: 'M3.34 19a10 10 0 1 1 17.32 0' }],
  ],
  sun: [
    ['circle', { cx: '12', cy: '12', r: '4' }],
    ['path', { d: 'M12 2v2' }],
    ['path', { d: 'M12 20v2' }],
    ['path', { d: 'm4.93 4.93 1.41 1.41' }],
    ['path', { d: 'm17.66 17.66 1.41 1.41' }],
    ['path', { d: 'M2 12h2' }],
    ['path', { d: 'M20 12h2' }],
    ['path', { d: 'm6.34 17.66-1.41 1.41' }],
    ['path', { d: 'm19.07 4.93-1.41 1.41' }],
  ],
  battery: [
    ['path', { d: 'M 22 14 L 22 10' }],
    ['rect', { x: '2', y: '6', width: '16', height: '12', rx: '2' }],
  ],
  zap: [
    [
      'path',
      {
        d: 'M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z',
      },
    ],
  ],
  timer: [
    ['line', { x1: '10', x2: '14', y1: '2', y2: '2' }],
    ['line', { x1: '12', x2: '15', y1: '14', y2: '11' }],
    ['circle', { cx: '12', cy: '14', r: '8' }],
  ],
  activity: [
    [
      'path',
      {
        d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2',
      },
    ],
  ],
  'person-standing': [
    ['circle', { cx: '12', cy: '5', r: '1' }],
    ['path', { d: 'm9 20 3-6 3 6' }],
    ['path', { d: 'm6 8 6 2 6-2' }],
    ['path', { d: 'M12 10v4' }],
  ],
  'door-open': [
    ['path', { d: 'M10 21H2' }],
    ['path', { d: 'M10 3H7a2 2 0 00-2 2v16' }],
    ['path', { d: 'M14 12h.01' }],
    [
      'path',
      { d: 'M19 21V5a2 2 0 00-1.675-1.974l-6.163-1.013A1 1 0 0010 3v18a1 1 0 001.124.992z' },
    ],
    ['path', { d: 'M22 21h-3' }],
  ],
  'door-closed': [
    ['path', { d: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16' }],
    ['path', { d: 'M2 21h20' }],
    ['path', { d: 'M9 12h.01' }],
  ],
  'app-window': [
    ['rect', { x: '2', y: '4', width: '20', height: '16', rx: '2' }],
    ['path', { d: 'M10 4v4' }],
    ['path', { d: 'M2 8h20' }],
    ['path', { d: 'M6 4v4' }],
  ],
  'circle-dot': [
    ['circle', { cx: '12', cy: '12', r: '1' }],
    ['circle', { cx: '12', cy: '12', r: '10' }],
  ],
  circle: [['circle', { cx: '12', cy: '12', r: '10' }]],
  flame: [
    [
      'path',
      {
        d: 'M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4',
      },
    ],
  ],
  snowflake: [
    ['path', { d: 'm10 20-1.25-2.5L6 18' }],
    ['path', { d: 'M10 4 8.75 6.5 6 6' }],
    ['path', { d: 'm14 20 1.25-2.5L18 18' }],
    ['path', { d: 'm14 4 1.25 2.5L18 6' }],
    ['path', { d: 'm17 21-3-6h-4' }],
    ['path', { d: 'm17 3-3 6 1.5 3' }],
    ['path', { d: 'M2 12h6.5L10 9' }],
    ['path', { d: 'm20 10-1.5 2 1.5 2' }],
    ['path', { d: 'M22 12h-6.5L14 15' }],
    ['path', { d: 'm4 10 1.5 2L4 14' }],
    ['path', { d: 'm7 21 3-6-1.5-3' }],
    ['path', { d: 'm7 3 3 6h4' }],
  ],
  music: [
    ['path', { d: 'M9 18V5l12-2v13' }],
    ['circle', { cx: '6', cy: '18', r: '3' }],
    ['circle', { cx: '18', cy: '16', r: '3' }],
  ],
  tv: [
    ['path', { d: 'm17 2-5 5-5-5' }],
    ['rect', { width: '20', height: '15', x: '2', y: '7', rx: '2' }],
  ],
  speaker: [
    ['rect', { width: '16', height: '20', x: '4', y: '2', rx: '2' }],
    ['path', { d: 'M12 6h.01' }],
    ['circle', { cx: '12', cy: '14', r: '4' }],
    ['path', { d: 'M12 14h.01' }],
  ],
  sparkles: [
    [
      'path',
      {
        d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
      },
    ],
    ['path', { d: 'M20 2v4' }],
    ['path', { d: 'M22 4h-4' }],
    ['circle', { cx: '4', cy: '20', r: '2' }],
  ],
  play: [
    [
      'path',
      { d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z' },
    ],
  ],
  workflow: [
    ['rect', { width: '8', height: '8', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M7 11v4a2 2 0 0 0 2 2h4' }],
    ['rect', { width: '8', height: '8', x: '13', y: '13', rx: '2' }],
  ],
  bot: [
    ['path', { d: 'M12 8V4H8' }],
    ['rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }],
    ['path', { d: 'M2 14h2' }],
    ['path', { d: 'M20 14h2' }],
    ['path', { d: 'M15 13v2' }],
    ['path', { d: 'M9 13v2' }],
  ],
  cctv: [
    [
      'path',
      { d: 'M16.75 12h3.632a1 1 0 0 1 .894 1.447l-2.034 4.069a1 1 0 0 1-1.708.134l-2.124-2.97' },
    ],
    [
      'path',
      {
        d: 'M17.106 9.053a1 1 0 0 1 .447 1.341l-3.106 6.211a1 1 0 0 1-1.342.447L3.61 12.3a2.92 2.92 0 0 1-1.3-3.91L3.69 5.6a2.92 2.92 0 0 1 3.92-1.3z',
      },
    ],
    ['path', { d: 'M2 19h3.76a2 2 0 0 0 1.8-1.1L9 15' }],
    ['path', { d: 'M2 21v-4' }],
    ['path', { d: 'M7 9h.01' }],
  ],
  lock: [
    ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  'lock-open': [
    ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 9.9-1' }],
  ],
  blinds: [
    ['path', { d: 'M3 3h18' }],
    ['path', { d: 'M20 7H8' }],
    ['path', { d: 'M20 11H8' }],
    ['path', { d: 'M10 19h10' }],
    ['path', { d: 'M8 15h12' }],
    ['path', { d: 'M4 3v14' }],
    ['circle', { cx: '4', cy: '19', r: '2' }],
  ],
  warehouse: [
    ['path', { d: 'M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11' }],
    [
      'path',
      {
        d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z',
      },
    ],
    ['path', { d: 'M6 13h12' }],
    ['path', { d: 'M6 17h12' }],
  ],
  user: [
    ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: '12', cy: '7', r: '4' }],
  ],
  'map-pin': [
    [
      'path',
      {
        d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
      },
    ],
    ['circle', { cx: '12', cy: '10', r: '3' }],
  ],
  shield: [
    [
      'path',
      {
        d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      },
    ],
  ],
  'list-checks': [
    ['path', { d: 'M13 5h8' }],
    ['path', { d: 'M13 12h8' }],
    ['path', { d: 'M13 19h8' }],
    ['path', { d: 'm3 17 2 2 4-4' }],
    ['path', { d: 'm3 7 2 2 4-4' }],
  ],
  calendar: [
    ['path', { d: 'M8 2v3' }],
    ['path', { d: 'M16 2v3' }],
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
    ['path', { d: 'M3 9h18' }],
  ],
  'cloud-sun': [
    ['path', { d: 'M12 2v2' }],
    ['path', { d: 'm4.93 4.93 1.41 1.41' }],
    ['path', { d: 'M20 12h2' }],
    ['path', { d: 'm19.07 4.93-1.41 1.41' }],
    ['path', { d: 'M15.947 12.65a4 4 0 0 0-5.925-4.128' }],
    ['path', { d: 'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z' }],
  ],
  'sliders-horizontal': [
    ['path', { d: 'M10 5H3' }],
    ['path', { d: 'M12 19H3' }],
    ['path', { d: 'M14 3v4' }],
    ['path', { d: 'M16 17v4' }],
    ['path', { d: 'M21 12h-9' }],
    ['path', { d: 'M21 19h-5' }],
    ['path', { d: 'M21 5h-7' }],
    ['path', { d: 'M8 10v4' }],
    ['path', { d: 'M8 12H3' }],
  ],
  list: [
    ['path', { d: 'M3 5h.01' }],
    ['path', { d: 'M3 12h.01' }],
    ['path', { d: 'M3 19h.01' }],
    ['path', { d: 'M8 5h13' }],
    ['path', { d: 'M8 12h13' }],
    ['path', { d: 'M8 19h13' }],
  ],
  type: [
    ['path', { d: 'M12 4v16' }],
    ['path', { d: 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2' }],
    ['path', { d: 'M9 20h6' }],
  ],
  house: [
    ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }],
    [
      'path',
      {
        d: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
      },
    ],
  ],
  'triangle-alert': [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  box: [
    [
      'path',
      {
        d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
      },
    ],
    ['path', { d: 'm3.3 7 8.7 5 8.7-5' }],
    ['path', { d: 'M12 22V12' }],
  ],
  siren: [
    ['path', { d: 'M7 18v-6a5 5 0 1 1 10 0v6' }],
    ['path', { d: 'M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z' }],
    ['path', { d: 'M21 12h1' }],
    ['path', { d: 'M18.5 4.5 18 5' }],
    ['path', { d: 'M2 12h1' }],
    ['path', { d: 'M12 2v1' }],
    ['path', { d: 'm4.929 4.929.707.707' }],
    ['path', { d: 'M12 12v6' }],
  ],
  heater: [
    ['path', { d: 'M11 8c2-3-2-3 0-6' }],
    ['path', { d: 'M15.5 8c2-3-2-3 0-6' }],
    ['path', { d: 'M6 10h.01' }],
    ['path', { d: 'M6 14h.01' }],
    ['path', { d: 'M10 16v-4' }],
    ['path', { d: 'M14 16v-4' }],
    ['path', { d: 'M18 16v-4' }],
    ['path', { d: 'M20 6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3' }],
    ['path', { d: 'M5 20v2' }],
    ['path', { d: 'M19 20v2' }],
  ],
  'refresh-cw': [
    ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
    ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
    ['path', { d: 'M8 16H3v5' }],
  ],
  wind: [
    ['path', { d: 'M12.8 19.6A2 2 0 1 0 14 16H2' }],
    ['path', { d: 'M17.5 8a2.5 2.5 0 1 1 2 4H2' }],
    ['path', { d: 'M9.8 4.4A2 2 0 1 1 11 8H2' }],
  ],
  smartphone: [
    ['rect', { width: '14', height: '20', x: '5', y: '2', rx: '2', ry: '2' }],
    ['path', { d: 'M12 18h.01' }],
  ],
  power: [
    ['path', { d: 'M12 2v10' }],
    ['path', { d: 'M18.4 6.6a9 9 0 1 1-12.77.04' }],
  ],
  'air-vent': [
    ['path', { d: 'M18 17.5a2.5 2.5 0 1 1-4 2.03V12' }],
    ['path', { d: 'M6 12H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'M6 8h12' }],
    ['path', { d: 'M6.6 15.572A2 2 0 1 0 10 17v-5' }],
  ],
  settings: [
    [
      'path',
      {
        d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
      },
    ],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  minus: [['path', { d: 'M5 12h14' }]],
  x: [
    ['path', { d: 'M18 6 6 18' }],
    ['path', { d: 'm6 6 12 12' }],
  ],
  bell: [
    ['path', { d: 'M10.268 21a2 2 0 0 0 3.464 0' }],
    [
      'path',
      {
        d: 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
      },
    ],
  ],
  'undo-2': [
    ['path', { d: 'M9 14 4 9l5-5' }],
    ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11' }],
  ],
  'grip-vertical': [
    ['circle', { cx: '9', cy: '12', r: '1' }],
    ['circle', { cx: '9', cy: '5', r: '1' }],
    ['circle', { cx: '9', cy: '19', r: '1' }],
    ['circle', { cx: '15', cy: '12', r: '1' }],
    ['circle', { cx: '15', cy: '5', r: '1' }],
    ['circle', { cx: '15', cy: '19', r: '1' }],
  ],
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
};

function getSensorLineIconName(entity) {
  const attributes = entity.attributes || {};
  const entityId = entity.entity_id.toLowerCase();
  switch (attributes.device_class) {
    case 'temperature':
      return 'thermometer';
    case 'humidity':
    case 'moisture':
      return 'droplet';
    case 'pressure':
    case 'atmospheric_pressure':
      return 'gauge';
    case 'illuminance':
      return 'sun';
    case 'battery':
      return 'battery';
    case 'power':
    case 'energy':
    case 'voltage':
    case 'current':
      return 'zap';
    case 'wind_speed':
      return 'wind';
    default:
      break;
  }
  if (
    attributes.finishes_at ||
    attributes.end_time ||
    attributes.finish_time ||
    attributes.duration ||
    entityId.includes('timer')
  ) {
    return 'timer';
  }
  if (entityId.includes('battery')) return 'battery';
  if (entityId.includes('temperature') || entityId.includes('temp')) return 'thermometer';
  return 'activity';
}

function getBinarySensorLineIconName(entity) {
  const isOn = entity.state === 'on';
  switch (entity.attributes?.device_class) {
    case 'motion':
    case 'occupancy':
    case 'presence':
      return 'person-standing';
    case 'door':
    case 'garage_door':
    case 'opening':
      return isOn ? 'door-open' : 'door-closed';
    case 'window':
      return 'app-window';
    case 'moisture':
      return 'droplets';
    case 'smoke':
    case 'heat':
      return 'flame';
    case 'lock':
      return isOn ? 'lock-open' : 'lock';
    case 'battery':
      return 'battery';
    case 'power':
    case 'plug':
      return 'plug';
    default:
      return isOn ? 'circle-dot' : 'circle';
  }
}

/**
 * Name of the line icon that stands for an entity when no custom or Home Assistant icon applies.
 * @param {Object} entity - Home Assistant entity state object.
 * @returns {string} A key of LINE_ICONS.
 */
function getEntityLineIconName(entity) {
  if (!entity?.entity_id) return 'box';
  const domain = entity.entity_id.split('.')[0];
  const entityState = entity.state;
  const attributes = entity.attributes || {};
  switch (domain) {
    case 'light':
      return 'lightbulb';
    case 'switch':
      return 'plug';
    case 'input_boolean':
      return entityState === 'on' ? 'toggle-right' : 'toggle-left';
    case 'fan':
      return 'fan';
    case 'sensor':
      return getSensorLineIconName(entity);
    case 'binary_sensor':
      return getBinarySensorLineIconName(entity);
    case 'climate':
      if (entityState === 'heat') return 'flame';
      if (entityState === 'cool') return 'snowflake';
      if (entityState === 'fan_only') return 'fan';
      return 'thermometer';
    case 'water_heater':
      return 'heater';
    case 'humidifier':
      return 'droplets';
    case 'media_player':
      if (attributes.device_class === 'tv') return 'tv';
      if (attributes.device_class === 'speaker') return 'speaker';
      return 'music';
    case 'scene':
      return 'sparkles';
    case 'script':
      return 'play';
    case 'automation':
      return 'workflow';
    case 'button':
    case 'input_button':
      return 'circle-dot';
    case 'camera':
      return 'cctv';
    case 'lock':
      return entityState === 'locked' ? 'lock' : 'lock-open';
    case 'cover':
      if (attributes.device_class === 'garage') return 'warehouse';
      if (attributes.device_class === 'door' || attributes.device_class === 'gate') {
        return entityState === 'open' ? 'door-open' : 'door-closed';
      }
      if (attributes.device_class === 'window') return 'app-window';
      return 'blinds';
    case 'person':
      return entityState === 'home' ? 'house' : 'user';
    case 'device_tracker':
      return entityState === 'home' ? 'house' : 'smartphone';
    case 'zone':
      return 'map-pin';
    case 'alarm_control_panel':
      return 'shield';
    case 'siren':
      return 'siren';
    case 'vacuum':
      return 'bot';
    case 'timer':
      return 'timer';
    case 'todo':
      return 'list-checks';
    case 'calendar':
      return 'calendar';
    case 'weather':
      return 'cloud-sun';
    case 'sun':
      return 'sun';
    case 'input_number':
    case 'number':
      return 'sliders-horizontal';
    case 'input_select':
    case 'select':
      return 'list';
    case 'input_text':
    case 'text':
      return 'type';
    case 'update':
      return 'refresh-cw';
    case 'remote':
      return 'power';
    case 'valve':
      return 'air-vent';
    default:
      return 'box';
  }
}

/**
 * Decide how an entity's icon should be drawn.
 * @param {Object} entity - Home Assistant entity state object.
 * @param {Object} [options]
 * @param {boolean} [options.ignoreCustomIcon=false] - Skip the user's custom icon.
 * @returns {{kind: 'custom'|'mdi', glyph: string}|{kind: 'line', name: string}}
 */
function getEntityIconDescriptor(entity, options = {}) {
  if (!entity?.entity_id) return { kind: 'line', name: 'box' };
  if (!options.ignoreCustomIcon) {
    const customIcon = normalizeEntityIconGlyph(
      state.CONFIG?.customEntityIcons?.[entity.entity_id]
    );
    if (customIcon) return { kind: 'custom', glyph: customIcon };
  }
  const homeAssistantIcon = getHomeAssistantMdiGlyph(entity.attributes?.icon);
  if (homeAssistantIcon) return { kind: 'mdi', glyph: homeAssistantIcon };
  return { kind: 'line', name: getEntityLineIconName(entity) };
}

function hasLineIcon(name) {
  return Object.prototype.hasOwnProperty.call(LINE_ICONS, name);
}

/**
 * Build a line icon as an SVG element. Sized 1em so it follows the container's font-size, the
 * same knob that sizes emoji and MDI glyphs in every tile layout.
 * @param {string} name - A key of LINE_ICONS; unknown names fall back to 'box'.
 * @returns {SVGSVGElement}
 */
function createLineIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'entity-line-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '1em');
  svg.setAttribute('height', '1em');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', LINE_ICON_STROKE_WIDTH);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.icon = hasLineIcon(name) ? name : 'box';
  for (const [tagName, attributes] of LINE_ICONS[svg.dataset.icon]) {
    const child = document.createElementNS(SVG_NS, tagName);
    for (const [key, value] of Object.entries(attributes)) child.setAttribute(key, value);
    svg.appendChild(child);
  }
  return svg;
}

/**
 * Replace an element's content with a line icon (for chrome buttons such as reorganize or undo).
 * @param {Element} element - Target element.
 * @param {string} name - A key of LINE_ICONS.
 * @returns {SVGSVGElement|null}
 */
function setLineIconContent(element, name) {
  if (!element) return null;
  const icon = createLineIcon(name);
  element.replaceChildren(icon);
  return icon;
}

/**
 * Serialize a line icon for code paths that assemble tiles as HTML strings.
 * @param {string} name - A key of LINE_ICONS.
 * @returns {string}
 */
function lineIconMarkup(name) {
  const iconName = hasLineIcon(name) ? name : 'box';
  const children = LINE_ICONS[iconName]
    .map(([tagName, attributes]) => {
      const attrs = Object.entries(attributes)
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');
      return `<${tagName} ${attrs}></${tagName}>`;
    })
    .join('');
  return (
    `<svg class="entity-line-icon" data-icon="${iconName}" viewBox="0 0 24 24" width="1em" ` +
    `height="1em" fill="none" stroke="currentColor" stroke-width="${LINE_ICON_STROKE_WIDTH}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
    `${children}</svg>`
  );
}

function escapeGlyph(glyph) {
  return String(glyph)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function descriptorKey(descriptor) {
  return descriptor.kind === 'line'
    ? `line:${descriptor.name}`
    : `${descriptor.kind}:${descriptor.glyph}`;
}

/**
 * HTML for an entity icon, for template-built tiles. Glyphs are escaped.
 * @param {Object} entity - Home Assistant entity state object.
 * @param {Object} [options] - Forwarded to getEntityIconDescriptor.
 * @returns {string}
 */
function entityIconMarkup(entity, options = {}) {
  const descriptor = getEntityIconDescriptor(entity, options);
  return descriptor.kind === 'line'
    ? lineIconMarkup(descriptor.name)
    : escapeGlyph(descriptor.glyph);
}

/**
 * The data-icon-kind value to stamp on an icon container so CSS can size emoji, MDI glyphs and
 * line icons independently.
 * @param {Object} entity - Home Assistant entity state object.
 * @returns {'custom'|'mdi'|'line'}
 */
function getEntityIconKind(entity, options = {}) {
  return getEntityIconDescriptor(entity, options).kind;
}

/**
 * Draw an entity's icon into a container, replacing what was there. Re-rendering the same icon is
 * a no-op, so live state updates don't churn the DOM.
 * @param {Element} element - Icon container (e.g. .control-icon).
 * @param {Object} entity - Home Assistant entity state object.
 * @param {Object} [options] - Forwarded to getEntityIconDescriptor.
 * @returns {Object|null} The descriptor that was drawn.
 */
function renderEntityIcon(element, entity, options = {}) {
  if (!element) return null;
  const descriptor = getEntityIconDescriptor(entity, options);
  const key = descriptorKey(descriptor);
  if (element.dataset.iconKey === key && element.childNodes.length) return descriptor;
  element.dataset.iconKey = key;
  element.dataset.iconKind = descriptor.kind;
  if (descriptor.kind === 'line') {
    element.replaceChildren(createLineIcon(descriptor.name));
  } else {
    element.textContent = descriptor.glyph;
  }
  return descriptor;
}

export {
  LINE_ICONS,
  createLineIcon,
  entityIconMarkup,
  getEntityIconDescriptor,
  getEntityIconKind,
  getEntityLineIconName,
  lineIconMarkup,
  renderEntityIcon,
  setLineIconContent,
};
