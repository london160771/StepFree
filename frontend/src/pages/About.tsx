export function About() {
  return (
    <main className="h-full overflow-y-auto px-5 pb-12 pt-24">
      <article className="mx-auto max-w-xl space-y-6 rounded-3xl bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">About StepFree</h1>
        <p className="text-xl font-semibold leading-snug text-teal-800">
          The shortest route isn’t useful if you can’t use it. StepFree finds the route you actually can.
        </p>
        <p className="text-lg leading-relaxed text-slate-700">
          For wheelchair users, elderly people, injured people and parents with strollers, one broken lift can turn a
          familiar journey into a dead end. When that happens mid-trip, it costs more than time. It chips away at the
          confidence to travel independently.
        </p>
        <p className="text-lg leading-relaxed text-slate-700">
          StepFree reacts when accessibility infrastructure changes. TfL tells StepFree what changed. FalkorDB holds the
          connected network of stations, lines, lifts and step-free connections, works out what that change affects, and
          finds the new route you can still use.
        </p>
        <p className="text-lg leading-relaxed text-slate-700">
          This is a proof of concept covering 17 London Underground stations: Victoria, Green Park, St James’s Park,
          Westminster, Waterloo, Southwark, London Bridge, Bond Street, Tottenham Court Road, King’s Cross St Pancras,
          Paddington, Liverpool Street, Farringdon, Moorgate, Canary Wharf, Tower Hill and Canada Water.
        </p>
        <div className="rounded-2xl bg-slate-50 p-4 text-base text-slate-700">
          <p className="font-semibold text-slate-900">Credits</p>
          <p className="mt-1">Graph routing by FalkorDB. Transit, station topology and lift data from Transport for London.</p>
          <p className="mt-2 text-sm text-slate-500">Powered by TfL Open Data.</p>
        </div>
        <a href="#/" className="btn-primary text-center">
          Back to the map
        </a>
      </article>
    </main>
  );
}
