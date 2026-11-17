import { CONTROLS } from '@/content/controls'
import { Fragment } from 'react'
import { Keycap } from '../kit/Keycap'
import { Panel } from '../kit/Panel'
import { portfolioHref } from '../lib/links'
import { useUIMode } from '../lib/mode'
import { PanelLink, Section } from './common'
import type { PanelComponentProps } from './registry'

/** Help: controls table from content/controls.ts (keyboard + touch) and a short wayfinding guide. */
export default function HelpPanel({ onClose }: PanelComponentProps) {
  const mode = useUIMode()
  return (
    <Panel
      title="Help & controls"
      kicker="Operator manual"
      size="lg"
      tone="hmi"
      onClose={onClose}
      testId="panel-help"
      footer={
        <>
          <PanelLink to="directory" variant="primary" icon="map">
            Open the directory
          </PanelLink>
          <PanelLink to="quicklinks" icon="links">
            Portfolio quick links
          </PanelLink>
          <PanelLink to="settings" icon="sliders" variant="ghost">
            Settings
          </PanelLink>
        </>
      }
    >
      {mode === 'fallback' && (
        <p className="miw-callout miw-callout--note">
          The 3D factory isn’t running on this device, so the game controls below don’t apply. Every portfolio page is still available from the
          top bar.
        </p>
      )}
      <Section title="Controls">
        <table className="miw-controls" role="table">
          <caption className="sr-only">Keyboard, mouse and touch controls</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">Action</th>
              <th scope="col" role="columnheader">Keyboard &amp; mouse</th>
              <th scope="col" role="columnheader">Touch</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {CONTROLS.map((c) => (
              <tr key={c.action} role="row">
                <th scope="row" role="rowheader">
                  {c.action}
                </th>
                <td data-label="Keyboard & mouse" role="cell">
                  {c.keys.map((k, i) => (
                    <Fragment key={k}>
                      {i > 0 && <span className="miw-controls__or"> or </span>}
                      <Keycap size="sm">{k}</Keycap>
                    </Fragment>
                  ))}
                </td>
                <td data-label="Touch" role="cell">{c.touch ?? <span className="miw-controls__na">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="How to find things">
        <ol className="miw-steps">
          <li>
            <strong>Open the directory</strong> with <Keycap size="sm">M</Keycap> or the Directory button. Every portfolio destination has{' '}
            <em>Open now</em>, so no walking is required.
          </li>
          <li>
            <strong>Prefer the scenic route?</strong> Pick <em>Show route</em> for a painted path and beacon, or <em>Travel there</em> to fast-travel.
          </li>
          <li>
            <strong>Follow the colours.</strong> Each zone has its own colour on the floor paint, the signs and the map.
          </li>
          <li>
            <strong>Walk up to machines and people.</strong> When a prompt appears, press <Keycap size="sm">E</Keycap> (or tap Interact).
          </li>
          <li>
            <strong>Stuck?</strong> Press <Keycap size="sm">R</Keycap> to recover. <Keycap size="sm">C</Keycap> recenters the camera.
          </li>
          <li>
            <strong>Short on time?</strong> Use the portfolio quick links (<Keycap size="sm">P</Keycap>) or{' '}
            <a href={portfolioHref()}>skip the game and view the portfolio</a>.
          </li>
        </ol>
      </Section>
    </Panel>
  )
}
