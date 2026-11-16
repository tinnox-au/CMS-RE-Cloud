import { useEffect, useState } from 'react';
import { contrastRatio, composite, parseColour, type Rgb } from '../../lib/contrast.ts';
import { cssVars, cx, Icon } from '../../ui/index.ts';
import { CircleCheck, CircleExclamationPoint } from '../../ui/icons.ts';
import { Demo, Section } from './Section.tsx';

interface TokenInfo {
  readonly name: string;
  readonly use: string;
}

const COLOUR_GROUPS: readonly { readonly title: string; readonly tokens: readonly TokenInfo[] }[] =
  [
    {
      title: 'Surfaces',
      tokens: [
        { name: '--bg', use: 'Page background, sidebar' },
        { name: '--surface', use: 'Cards, tables, dialogs, inputs' },
        { name: '--surface-2', use: 'Inset fill inside a card, hover rows' },
        { name: '--surface-3', use: 'Control fill: search, segmented track' },
        { name: '--neutral-bg', use: 'Skeletons, meter tracks' },
        { name: '--glass', use: 'Sticky header' },
        { name: '--scrim', use: 'Dialog backdrop' },
      ],
    },
    {
      title: 'Fills',
      tokens: [
        { name: '--fill', use: 'Secondary button, code, selected row' },
        { name: '--fill-hover', use: 'Hover of the above' },
        { name: '--fill-disabled', use: 'Disabled button' },
      ],
    },
    {
      title: 'Lines',
      tokens: [
        { name: '--line', use: 'Hairlines between rows' },
        { name: '--line-strong', use: 'Dividers that must show' },
        { name: '--line-control', use: 'Input and checkbox boundaries' },
      ],
    },
    {
      title: 'Text',
      tokens: [
        { name: '--ink', use: 'Primary text' },
        { name: '--ink-2', use: 'Secondary text, placeholders' },
        { name: '--ink-3', use: 'Disabled text only' },
      ],
    },
    {
      title: 'Accent',
      tokens: [
        { name: '--accent', use: 'Filled controls: primary button, checked box' },
        { name: '--accent-hover', use: 'Hover of a filled control' },
        { name: '--on-accent', use: 'Text on an accent fill' },
        { name: '--link', use: 'Links, text buttons, active icons' },
        { name: '--link-hover', use: 'Hover of a link' },
        { name: '--nav-icon', use: 'Sidebar section icons' },
        { name: '--focus', use: 'Focus ring, focused field border' },
        { name: '--focus-halo', use: 'Soft ring around a focused field' },
      ],
    },
    {
      title: 'Status',
      tokens: [
        { name: '--ok', use: 'Ready, in sync, success' },
        { name: '--ok-bg', use: 'Its tint' },
        { name: '--ok-hover', use: 'A switch that is on, hovered' },
        { name: '--warn', use: 'Processing, attention' },
        { name: '--warn-bg', use: 'Its tint' },
        { name: '--danger', use: 'Errors, destructive actions' },
        { name: '--danger-bg', use: 'Its tint, destructive button fill' },
        { name: '--on-danger', use: 'Text on a danger fill' },
        { name: '--danger-text-hover', use: 'Destructive text button, hovered' },
        { name: '--danger-solid-hover', use: 'Filled destructive button, hovered' },
        { name: '--chip-pressed-hover', use: 'A pressed chip, hovered' },
      ],
    },
    {
      title: 'Tag colours',
      tokens: ['teal', 'sky', 'slate', 'green', 'amber', 'red', 'violet', 'pink'].map((name) => ({
        name: `--tag-${name}`,
        use: 'Tag dot',
      })),
    },
  ];

interface PairInfo {
  readonly fore: string;
  readonly back: string;
  readonly use: string;
  /** 4.5 for text, 3 for boundaries and indicators. */
  readonly needs: 4.5 | 3;
}

const CONTRAST_PAIRS: readonly PairInfo[] = [
  { fore: '--ink', back: '--bg', use: 'Body text on the page', needs: 4.5 },
  { fore: '--ink', back: '--surface', use: 'Body text on a card', needs: 4.5 },
  { fore: '--ink', back: '--surface-3', use: 'Text on a control fill', needs: 4.5 },
  {
    fore: '--ink',
    back: '--fill',
    use: 'Secondary button, selected sidebar row, code',
    needs: 4.5,
  },
  { fore: '--ink-2', back: '--bg', use: 'Secondary text on the page', needs: 4.5 },
  { fore: '--ink-2', back: '--surface', use: 'Secondary text, table header', needs: 4.5 },
  { fore: '--ink-2', back: '--surface-2', use: 'Secondary text on a hovered row', needs: 4.5 },
  {
    fore: '--ink-2',
    back: '--surface-3',
    use: 'Search placeholder, capsule, clear disc',
    needs: 4.5,
  },
  { fore: '--ink-2', back: '--fill', use: 'Secondary text on a fill', needs: 4.5 },
  { fore: '--link', back: '--surface', use: 'Link, text button', needs: 4.5 },
  { fore: '--link', back: '--bg', use: 'Link on the page', needs: 4.5 },
  { fore: '--on-accent', back: '--accent', use: 'Primary button', needs: 4.5 },
  { fore: '--on-accent', back: '--accent-hover', use: 'Primary button, hovered', needs: 4.5 },
  { fore: '--on-danger', back: '--danger', use: 'Confirming a destructive action', needs: 4.5 },
  { fore: '--ok', back: '--surface', use: 'Status text, ok', needs: 4.5 },
  { fore: '--warn', back: '--surface', use: 'Status text, attention', needs: 4.5 },
  { fore: '--danger', back: '--surface', use: 'Status text, error', needs: 4.5 },
  { fore: '--danger', back: '--danger-bg', use: 'Destructive button, error banner', needs: 4.5 },
  { fore: '--surface', back: '--ink', use: 'Tooltip', needs: 4.5 },
  { fore: '--focus', back: '--surface', use: 'Focus ring on a card', needs: 3 },
  { fore: '--focus', back: '--bg', use: 'Focus ring on the page', needs: 3 },
  { fore: '--focus', back: '--surface-3', use: 'Focus ring on a control fill', needs: 3 },
  {
    fore: '--line-control',
    back: '--surface',
    use: 'Input and small select boundary on a card',
    needs: 3,
  },
  { fore: '--line-control', back: '--bg', use: 'Input boundary on the page', needs: 3 },
  { fore: '--accent', back: '--neutral-bg', use: 'Meter fill on its track', needs: 3 },
  { fore: '--nav-icon', back: '--bg', use: 'Sidebar section icon', needs: 3 },
  {
    fore: '--on-danger',
    back: '--danger-solid-hover',
    use: 'Destructive confirm, hovered',
    needs: 4.5,
  },
];

const ALL_TOKENS = Array.from(
  new Set([
    ...COLOUR_GROUPS.flatMap((group) => group.tokens.map((token) => token.name)),
    ...CONTRAST_PAIRS.flatMap((pair) => [pair.fore, pair.back]),
  ]),
);

/** The tokens' current values, read from the document and read again when the theme changes. */
function useTokenValues(): ReadonlyMap<string, string> {
  const [values, setValues] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      setValues(new Map(ALL_TOKENS.map((name) => [name, style.getPropertyValue(name).trim()])));
    };
    read();
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', read);
    return () => {
      scheme.removeEventListener('change', read);
    };
  }, []);
  return values;
}

function opaque(values: ReadonlyMap<string, string>, name: string, over: Rgb): Rgb | null {
  const parsed = parseColour(values.get(name) ?? '');
  return parsed === null ? null : composite(parsed, over);
}

function ContrastTable({ values }: { readonly values: ReadonlyMap<string, string> }) {
  const page = opaque(values, '--bg', { r: 255, g: 255, b: 255 });
  return (
    <div className="tx-table-card">
      <div className="tx-table-scroll">
        <table className="tx-table tx-table--compact">
          <caption className="tx-visually-hidden">Contrast of token pairs in this theme</caption>
          <thead>
            <tr>
              <th scope="col">Sample</th>
              <th scope="col">Pair</th>
              <th scope="col">Used for</th>
              <th scope="col" className="tx-table__cell--end">
                Ratio
              </th>
              <th scope="col">Needs</th>
            </tr>
          </thead>
          <tbody>
            {CONTRAST_PAIRS.map((pair) => {
              const back = page === null ? null : opaque(values, pair.back, page);
              const fore = back === null ? null : opaque(values, pair.fore, back);
              const ratio = back === null || fore === null ? null : contrastRatio(fore, back);
              const passes = ratio !== null && ratio >= pair.needs;
              return (
                <tr key={`${pair.fore}-${pair.back}`} data-row="">
                  <td>
                    <span
                      className={cx('tx-sg-sample', pair.needs === 3 && 'tx-sg-sample--ring')}
                      style={cssVars({
                        '--tx-sg-fore': `var(${pair.fore})`,
                        '--tx-sg-back': `var(${pair.back})`,
                      })}
                      aria-hidden="true"
                    >
                      Aa
                    </span>
                  </td>
                  <td className="tx-table__cell--nowrap">
                    <span className="tx-mono">{pair.fore}</span> on{' '}
                    <span className="tx-mono">{pair.back}</span>
                  </td>
                  <td>{pair.use}</td>
                  <td className="tx-table__cell--end tx-table__cell--numeric">
                    {ratio === null ? 'not read' : `${ratio.toFixed(2)}:1`}
                  </td>
                  <td className="tx-table__cell--nowrap">
                    <span className="tx-cluster">
                      <Icon
                        icon={passes ? CircleCheck : CircleExclamationPoint}
                        size={16}
                        label={passes ? 'Meets' : 'Below'}
                      />
                      {pair.needs}:1 {pair.needs === 3 ? 'boundary' : 'text'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ColourSection() {
  const values = useTokenValues();
  return (
    <Section
      id="colour"
      title="Colour"
      lead="Components use colour only through these tokens. The values shown are the ones in effect now; switch the system between light and dark to see the other set."
    >
      {COLOUR_GROUPS.map((group) => (
        <Demo key={group.title} title={group.title} layout="page">
          <ul className="tx-sg-swatches">
            {group.tokens.map((token) => (
              <li key={token.name} className="tx-sg-swatch">
                <span
                  className="tx-sg-swatch__chip"
                  style={cssVars({ '--tx-sg-swatch': `var(${token.name})` })}
                  aria-hidden="true"
                />
                <span className="tx-sg-swatch__text">
                  <span className="tx-mono tx-strong">{token.name}</span>
                  <span className="tx-small tx-muted tx-truncate">{token.use}</span>
                  <span className="tx-small tx-mono tx-truncate">
                    {values.get(token.name) ?? ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Demo>
      ))}
      <Demo
        title="Contrast in this theme"
        layout="page"
        note="Ratios are computed in the browser from the values above. The same pairs, and more, are checked for both themes by src/styles/tokens.test.ts."
      >
        <ContrastTable values={values} />
      </Demo>
    </Section>
  );
}

const TYPE_STYLES: readonly {
  readonly name: string;
  readonly spec: string;
  readonly className: string;
  readonly sample: string;
}[] = [
  {
    name: 'Numeral',
    spec: '600, 44 / 48, -0.03em, tabular',
    className: 'tx-numeral',
    sample: '128',
  },
  {
    name: 'Page title',
    spec: '700, 34 / 40, -0.022em (also tx-display)',
    className: 'tx-h1',
    sample: 'Media library',
  },
  {
    name: 'Card title',
    spec: '600, 21 / 28, -0.01em',
    className: 'tx-h2',
    sample: 'Changes waiting',
  },
  {
    name: 'Heading',
    spec: '600, 15 / 20, -0.01em',
    className: 'tx-h3',
    sample: 'Assigned content',
  },
  {
    name: 'Row title',
    spec: '500, 15 / 20, -0.01em',
    className: 'tx-row-title',
    sample: 'Reception PC monitor',
  },
  {
    name: 'Body',
    spec: '400, 14 / 20, -0.005em',
    className: 'tx-body',
    sample: 'Editing or assigning changes nothing on a screen until it is pushed.',
  },
  {
    name: 'Body strong',
    spec: '600, 14 / 20, -0.005em',
    className: 'tx-body tx-strong',
    sample: 'Foyer welcome loop',
  },
  {
    name: 'Caption',
    spec: '400, 13 / 18 (tx-small; with tx-muted for secondary text)',
    className: 'tx-small tx-muted',
    sample: 'Last report 12 seconds ago',
  },
  {
    name: 'Label',
    spec: '600, 12 / 16, ink-2 (tx-caption: group labels, table headers)',
    className: 'tx-caption',
    sample: 'Modified',
  },
  {
    name: 'Mono',
    spec: 'System monospace, for codes, ids and hashes',
    className: 'tx-mono',
    sample: 'K7QM-2XRD   9f2c41d0   publication.create',
  },
  {
    name: 'Tabular numbers',
    spec: 'tx-num, for tables, counters and durations',
    className: 'tx-body tx-num',
    sample: '1,111.10   2,480.75   0:42   12:08',
  },
];

export function TypographySection() {
  return (
    <Section
      id="type"
      title="Typography"
      lead="One family: the system typeface (San Francisco on Apple devices), and self-hosted Inter, served from the portal's own origin, everywhere else."
    >
      <Demo title="Scale" layout="stack">
        <dl className="tx-sg-type">
          {TYPE_STYLES.map((style) => (
            <div key={style.name} className="tx-sg-type__row">
              <dt className="tx-sg-type__spec">
                <span className="tx-strong">{style.name}</span>
                <span>{style.spec}</span>
              </dt>
              <dd className={style.className}>{style.sample}</dd>
            </div>
          ))}
        </dl>
      </Demo>
    </Section>
  );
}
