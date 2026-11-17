import { Page } from '../../shell/Page.tsx';
import { EmptyState, type IconComponent } from '../../ui/index.ts';
import { AudioLines, FileText, Globe, LayoutTemplate, Users } from '../../ui/icons.ts';

/** The sections that are in the navigation but not built yet. */
export type PlannedSection = 'audio' | 'documents' | 'web-pages' | 'layouts' | 'users';

interface PlannedContent {
  /** The page's `h1`, as in docs/portal-v2/stage-a.md, section 1. */
  readonly title: string;
  readonly icon: IconComponent;
  /** The stage that brings the section (docs/portal-v2/README.md, sections 2 and 3). */
  readonly stage: 'B' | 'C';
  /** One sentence: what the section will do. */
  readonly text: string;
}

const PLANNED: { readonly [K in PlannedSection]: PlannedContent } = {
  audio: {
    title: 'Audio',
    icon: AudioLines,
    stage: 'C',
    text: 'Audio files will be uploaded and kept here, beside images and video, once stage C adds audio media.',
  },
  documents: {
    title: 'Documents',
    icon: FileText,
    stage: 'C',
    text: 'PDF documents will be uploaded and kept here, ready to show on screens, once stage C adds PDF media.',
  },
  'web-pages': {
    title: 'Web pages',
    icon: Globe,
    stage: 'C',
    text: 'Web pages to show on screens will be listed here in stage C, after a written security review, shown in a sandboxed frame, and switched off for each organisation until it is turned on.',
  },
  layouts: {
    title: 'Layouts',
    icon: LayoutTemplate,
    stage: 'B',
    text: 'Layouts that split a screen into several zones will be drawn here in a canvas editor in stage B.',
  },
  users: {
    title: 'Users',
    icon: Users,
    stage: 'C',
    text: 'People and their roles (owner, admin, editor and viewer) will be managed here in stage C.',
  },
};

/**
 * The page behind a navigation entry whose section is not built yet: what the section will
 * do and which stage brings it. It has no controls, so nothing here looks like it works.
 */
export function PlannedPage({ section }: { readonly section: PlannedSection }) {
  const content = PLANNED[section];
  return (
    <Page title={content.title}>
      <EmptyState icon={content.icon} title={`Planned for stage ${content.stage}`}>
        {content.text}
      </EmptyState>
    </Page>
  );
}
