import { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../ui/index.ts';
import { ButtonSection, DialogSection, MenuSection, ToastSection } from './ActionSections.tsx';
import { ControlSection, FormSectionDemo } from './FormSections.tsx';
import { ColourSection, TypographySection } from './FoundationSections.tsx';
import { ListSection } from './ListSection.tsx';
import { MediaSection, NavigationSection, SurfaceSection } from './SurfaceSections.tsx';
import './styleguide.css';

/** Section anchors, in page order. Each id is the `id` of a Section on the page. */
const SECTIONS: readonly (readonly [id: string, label: string])[] = [
  ['colour', 'Colour'],
  ['type', 'Typography'],
  ['buttons', 'Buttons'],
  ['menus', 'Menus'],
  ['dialogs', 'Dialogs'],
  ['toasts', 'Toasts'],
  ['forms', 'Forms'],
  ['controls', 'Selection controls'],
  ['lists', 'List page'],
  ['surfaces', 'Cards and notices'],
  ['media', 'Thumbnails and loading'],
  ['navigation', 'Navigation and help'],
];

/**
 * The gallery itself. It needs a router (several components render links) and a
 * ToastProvider above it; `StyleguidePage` supplies both when the page stands alone.
 */
export function StyleguideContent() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Style guide · TINNOX CMS';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="tx-sg">
      <a className="tx-skip-link" href="#main">
        Skip to content
      </a>
      <header className="tx-sg__header">
        <span className="tx-sg__brand">
          TINNOX <span className="tx-sg__brand-tag">CMS</span>
        </span>
        <h1>Style guide</h1>
        <p className="tx-sg__lead">
          Every portal v2 component in its variants and states. This page exists in development
          builds only and needs no sign-in. Every name, number and date on it is made up, and no
          control here changes anything.
        </p>
      </header>
      <nav className="tx-sg__nav" aria-label="Sections">
        <ul className="tx-sg__nav-list">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a className="tx-sg__nav-link" href={`#${id}`}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main id="main" className="tx-sg__main" tabIndex={-1}>
        <ColourSection />
        <TypographySection />
        <ButtonSection />
        <MenuSection />
        <DialogSection />
        <ToastSection />
        <FormSectionDemo />
        <ControlSection />
        <ListSection />
        <SurfaceSection />
        <MediaSection />
        <NavigationSection />
      </main>
    </div>
  );
}

/**
 * The style guide as a page of its own, outside the signed-in application: development
 * builds only (see App.tsx). Links inside the samples go to an in-memory router, so pressing
 * one never leaves the page.
 */
export default function StyleguidePage() {
  return (
    <MemoryRouter>
      <ToastProvider>
        <StyleguideContent />
      </ToastProvider>
    </MemoryRouter>
  );
}
