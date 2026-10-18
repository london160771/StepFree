import type { ReactNode } from 'react';

const REPO = 'https://github.com/london160771/StepFree';

/** The 17 supported London Underground stations. St James's Park is pass-through only; see "Current network". */
const SUPPORTED_STATIONS = [
  'Victoria',
  'Green Park',
  'St James’s Park',
  'Westminster',
  'Waterloo',
  'Southwark',
  'London Bridge',
  'Bond Street',
  'Tottenham Court Road',
  'King’s Cross St Pancras',
  'Paddington',
  'Liverpool Street',
  'Farringdon',
  'Moorgate',
  'Canary Wharf',
  'Tower Hill',
  'Canada Water',
] as const;

const SECTIONS = [
  { id: 'what', label: 'What is StepFree?' },
  { id: 'story', label: 'Story' },
  { id: 'using', label: 'Using StepFree' },
  { id: 'network', label: 'Current network' },
  { id: 'technology', label: 'Technology' },
  { id: 'vision', label: 'Vision' },
] as const;

export function About() {
  // The app uses the URL hash for pages, so contents links scroll in place instead of changing the hash.
  const jump = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <main className="h-full overflow-y-auto px-5 pb-12 pt-24">
      <article className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow-sm sm:p-10 [&_strong]:font-semibold">
        <header>
          <p className="eyebrow">About StepFree</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">What StepFree is, and how it works</h1>
          <p className="mt-4 text-lg font-medium leading-snug text-teal-800 sm:text-xl">The shortest route isn’t useful if you can’t use it. StepFree finds the route you actually can.</p>
          <nav aria-label="On this page" className="mt-6 rounded-2xl bg-slate-50 p-4">
            <p className="eyebrow">On this page</p>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#/about`} onClick={jump(s.id)} className="inline-block min-h-8 text-base font-medium text-teal-800 underline decoration-teal-800/30 underline-offset-4">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <Section id="what" eyebrow="The idea" title="What is StepFree?">
          <P>
            StepFree is an accessibility journey agent for public transport. The problem it starts from is simple: the shortest route is not useful if the
            person travelling cannot actually use it.
          </P>
          <P>
            StepFree looks at the accessibility connections a journey depends on (the lifts, the step-free transfers, the stations where you enter, change and
            leave) and helps find a route that can really be used. If something important becomes unavailable, it works out whether your current journey is
            affected and, if it is, uses the connected transport network to find another route.
          </P>
          <P>It is for anyone for whom stairs or an inaccessible transfer can make a journey difficult or impossible, including:</P>
          <ul className="max-w-prose list-disc space-y-1.5 pl-6 text-lg text-slate-700">
            <li>wheelchair users</li>
            <li>people with limited mobility</li>
            <li>people travelling with mobility aids</li>
            <li>older travellers</li>
            <li>parents travelling with pushchairs</li>
          </ul>
          <P>
            StepFree was built for <ExternalLink href="https://www.wemakedevs.org/hackathons/falkordb">Graph Hacks</ExternalLink>, powered by{' '}
            <ExternalLink href="https://www.falkordb.com/">FalkorDB</ExternalLink>. The journey network is a connected graph in FalkorDB, so the agent can reason
            over stations, Underground lines, step-free transfers, lifts and what depends on what. FalkorDB is not a store added on the side: without it,
            StepFree has no route. It is responsible for:
          </P>
          <ul className="max-w-prose list-disc space-y-1.5 pl-6 text-lg text-slate-700">
            <li>the connected journey representation</li>
            <li>weighted shortest-path routing</li>
            <li>the accessibility relationships between stations, lifts and transfers</li>
            <li>disruption-aware graph scenarios</li>
            <li>alternative routes and Plan B</li>
            <li>a small, factual memory of the decisions the agent made</li>
          </ul>
        </Section>

        <Section id="story" eyebrow="Why" title="Why I built StepFree">
          <P>
            My brother lives in London and uses the train regularly. Talking with him about stations, journeys and some of the problems he had run into made me
            think much more closely about how complicated public transport can become. He had also seen other travellers struggling around stations and
            connections.
          </P>
          <P>
            That made me look at the same journeys from the point of view of someone for whom accessibility is not optional. A route planner can say a journey is
            possible, but one inaccessible connection can completely change that for another person.
          </P>
          <P>
            That became StepFree: a journey tool that asks “What route can this person actually use?”, not only “What is the shortest route?”
          </P>
        </Section>

        <Section id="using" eyebrow="Guide" title="Using StepFree">
          <h3 className="text-xl font-medium text-slate-900">Demo Mode</h3>
          <P>
            Demo Mode works from anywhere. It needs no location permission and does not depend on anything happening in London right now. You can choose any
            supported From and To stations and plan a step-free journey. For each journey you can see:
          </P>
          <ul className="max-w-prose list-disc space-y-1.5 pl-6 text-lg text-slate-700">
            <li>Route Health, which says whether the journey is currently usable</li>
            <li>a Plan B route, when another step-free route exists</li>
            <li>“Why this route?”, in plain words</li>
            <li>“How StepFree decided”, a record of the checks the agent ran (not its private reasoning)</li>
          </ul>
          <P>
            <strong>Run Demo</strong> loads the ready-made Victoria → London Bridge journey. You can then simulate one disruption at a time and watch the agent
            decide what it means for the journey. There are three simulated Demo Mode events: a <strong>lift outage</strong>, a <strong>station closure</strong>{' '}
            and a <strong>line disruption</strong>.
          </P>
          <Callout>
            These are simulated Demo Mode events, chosen so the behaviour is repeatable. They are not current disruptions on the real network. If you pick a
            journey a simulated event does not touch, the agent says so and keeps your route.
          </Callout>

          <h3 className="mt-8 text-xl font-medium text-slate-900">Live Mode</h3>
          <P>
            Live Mode is currently London-only. It asks for your browser’s location permission, then maps your position to the nearest supported station and plans
            from there. If you decline, Live Mode does not start and Demo Mode stays available. Only the nearest station is passed to the agent, not your
            coordinates.
          </P>
          <P>
            Live Mode currently uses real Transport for London lift-disruption data. It does <strong>not</strong> currently use live station closures, live line
            disruption rerouting, real-time train delays or train arrival predictions. Journey times are weights from TfL timetable data, not delay-adjusted
            estimates of when you will arrive.
          </P>
        </Section>

        <Section id="network" eyebrow="Coverage" title="Current network">
          <P>
            StepFree is a proof of concept covering <strong>17 London Underground stations</strong>. It covers the Underground only, and it is not a
            London-wide journey planner.
          </P>
          <ul className="grid list-none grid-cols-1 gap-x-6 gap-y-1 pl-0 text-lg text-slate-700 sm:grid-cols-2" aria-label="Supported stations">
            {SUPPORTED_STATIONS.map((station) => (
              <li key={station} className="border-b border-slate-100 py-1">
                {station}
              </li>
            ))}
          </ul>
          <P>
            Not every listed station can be used the same way. St James’s Park has no step-free access in TfL’s data, so it is pass-through only: the supported
            fallback journey rides through it without anyone boarding, alighting or changing there. A few stations have platforms or directions without
            step-free access (for example, Liverpool Street’s Central line platforms), and those are never used for a journey.
          </P>
          <h3 className="mt-8 text-xl font-medium text-slate-900">Where the data comes from</h3>
          <P>
            The supported network was built from official <ExternalLink href="https://tfl.gov.uk/info-for-open-data-users/">Transport for London</ExternalLink>{' '}
            data: detailed station topology, platform and direction information, step-free connections, lift topology, Underground route sequences, timetable
            running times and StopPoint coordinates.
          </P>
          <P>
            Ride durations come from TfL timetable data. Station transfer times are estimates, worked out from the station topology, walking distance and lift
            use. Routes are <em>based on currently available TfL accessibility data.</em> StepFree is an independent project and is not endorsed by TfL. It uses
            data powered by TfL Open Data.
          </P>
        </Section>

        <Section id="technology" eyebrow="Under the hood" title="How StepFree works">
          <ol className="space-y-2 text-lg text-slate-700">
            {[
              'You choose a journey.',
              'StepFree’s agent looks at the connected transport graph.',
              'FalkorDB finds the shortest valid step-free path.',
              'StepFree checks the accessibility connections the route depends on.',
              'It checks the current disruption evidence.',
              'The agent decides whether the journey is still usable.',
              'If not, FalkorDB calculates another valid route.',
              'StepFree explains the result.',
            ].map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-50 text-sm font-medium text-teal-800">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <P>
            “How StepFree decided” shows safe execution evidence: which tools the agent called, with what arguments, what they returned and how long they took.
            It never shows the model’s private reasoning.
          </P>

          <h3 className="mt-8 text-xl font-medium text-slate-900">Built with FalkorDB</h3>
          <P>This is what makes StepFree a graph problem rather than a list of routes:</P>
          <ul className="max-w-prose list-disc space-y-1.5 pl-6 text-lg text-slate-700">
            <li>stations and their access points (street entrances and platforms) are graph nodes</li>
            <li>ride relationships and step-free-transfer relationships connect them</li>
            <li>travel-time weights let FalkorDB’s shortest-path algorithm find the quickest valid route</li>
            <li>a disruption temporarily makes the graph connections that depend on it unavailable</li>
            <li>FalkorDB then recomputes the route that can still be used, and the Plan B alongside it</li>
            <li>lightweight JourneySession and AgentDecision records keep a factual memory of what the agent did</li>
          </ul>
          <P>The graph is why a closed lift can be traced to exactly the journeys it affects, and why the alternative comes from the network itself.</P>

          <h3 className="mt-8 text-xl font-medium text-slate-900">The agent and MCP</h3>
          <P>
            The agent does not write database queries. It chooses from a fixed set of validated StepFree tools exposed through the{' '}
            <ExternalLink href="https://modelcontextprotocol.io/">Model Context Protocol</ExternalLink> (MCP), and those tools perform controlled graph
            operations. Gemini never connects to FalkorDB directly:
          </P>
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-base font-medium text-slate-800">Gemini → StepFree agent host → MCP tools → FalkorDB / TfL</p>
          <P>Today the agent can plan step-free routes, inspect the accessibility dependencies of a route, check disruptions, reroute through the graph, find a Plan B, report Route Health, record its decisions and show a safe execution trace.</P>

          <h3 className="mt-8 text-xl font-medium text-slate-900">Other technology</h3>
          <dl className="divide-y divide-slate-100 text-base text-slate-700">
            <Tech label="Frontend">React, TypeScript, Vite, Tailwind CSS, Framer Motion</Tech>
            <Tech label="Map">
              <ExternalLink href="https://maplibre.org/">MapLibre GL JS</ExternalLink>, <ExternalLink href="https://openfreemap.org/">OpenFreeMap</ExternalLink>,
              OpenStreetMap / OpenMapTiles data
            </Tech>
            <Tech label="Backend">Node.js, Express, TypeScript</Tech>
            <Tech label="Agent">
              <ExternalLink href="https://ai.google.dev/">Gemini</ExternalLink> 3.8 Flash, MCP
            </Tech>
            <Tech label="Transport data">Transport for London APIs and datasets</Tech>
            <Tech label="App">Progressive Web App (installable; Live Mode needs a connection)</Tech>
          </dl>
          <P>
            The code is open at <ExternalLink href={REPO}>github.com/london160771/StepFree</ExternalLink>.
          </P>
        </Section>

        <Section id="vision" eyebrow="Next" title="Where StepFree can go">
          <P>
            This 17-station London network is a proof of concept. The longer-term idea is to grow it:
          </P>
          <ul className="max-w-prose list-disc space-y-1.5 pl-6 text-lg text-slate-700">
            <li>across the full London transport network</li>
            <li>to more kinds of accessibility infrastructure</li>
            <li>with more live disruption feeds</li>
            <li>across more transport modes</li>
            <li>with accessibility preferences for different travellers</li>
          </ul>
          <P>
            Beyond London, I would like to bring the same accessibility-graph approach to major cities around the world, such as New York, Paris and Tokyo.
          </P>
          <P>
            I would also like to explore what this could look like in Nigeria as more structured public-transport data becomes available, especially in cities
            such as Lagos and Abuja. That depends on the data existing, and nothing here assumes it already does.
          </P>
        </Section>

        <Section id="closing" eyebrow="Finally" title="Closing note">
          <P>
            StepFree started as a hackathon project, but the problem is bigger than the hackathon. A transport system can technically connect two places and still
            fail to give everyone a journey they can use. The goal is simple: help people understand the route they can actually use.
          </P>
          <p className="text-xl font-medium leading-snug text-teal-800">The shortest route isn’t useful if you can’t use it.</p>
        </Section>

        <a href="#/" className="btn-primary mt-10 text-center">
          Back to the map
        </a>
      </article>
    </main>
  );
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-24 space-y-4 border-t border-slate-100 pt-10" aria-labelledby={`${id}-title`}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

const P = ({ children }: { children: ReactNode }) => <p className="max-w-prose text-pretty text-lg leading-relaxed text-slate-700">{children}</p>;

const Callout = ({ children }: { children: ReactNode }) => (
  <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-base leading-relaxed text-amber-950">{children}</p>
);

function Tech({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[9rem_1fr]">
      <dt className="font-medium text-slate-900">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-teal-800 underline decoration-teal-800/30 underline-offset-4">
      {children}
    </a>
  );
}
