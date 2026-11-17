import { getProject } from '@/content/projects'
import { ExternalLink, Panel } from '../kit/Panel'
import { repoPath } from '../lib/links'
import { Chips, PanelLink, Section } from './common'
import type { PanelComponentProps } from './registry'

/** One project in detail (params.projectId → content/projects.ts). */
export default function ProjectPanel({ params, onClose }: PanelComponentProps) {
  const project = getProject(params?.projectId ?? '')

  if (!project) {
    return (
      <Panel title="Project not found" kicker="Server Hall" size="sm" tone="paper" onClose={onClose} testId="panel-project">
        <p>That project isn’t in the catalogue.</p>
        <PanelLink to="github" variant="primary" icon="code">
          Browse all projects
        </PanelLink>
      </Panel>
    )
  }

  return (
    <Panel
      title={project.name}
      kicker={project.station === 'rnd' ? 'R&D Annex · Featured build' : 'Server Hall · Repository'}
      size="md"
      tone="paper"
      onClose={onClose}
      testId="panel-project"
      footer={
        <>
          <ExternalLink href={project.url} className="miw-btn miw-btn--primary">
            View on GitHub
          </ExternalLink>
          <PanelLink to="github" icon="code">
            All projects
          </PanelLink>
          {project.featured && (
            <PanelLink to="rnd" icon="flask" variant="ghost">
              R&amp;D Annex
            </PanelLink>
          )}
        </>
      }
    >
      <p className="miw-repo-path" aria-hidden="true">
        {repoPath(project.url)}
      </p>
      <p className="miw-lede">{project.oneLiner}</p>
      {project.details.map((d) => (
        <p key={d}>{d}</p>
      ))}
      {project.caveat && (
        <p className="miw-caveat-box">
          <span className="miw-tag">Note</span> {project.caveat}
        </p>
      )}
      {project.tech.length > 0 && (
        <Section title="Technologies">
          <Chips items={project.tech} label="Technologies" />
        </Section>
      )}
    </Panel>
  )
}
