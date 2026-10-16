import type { ReactNode } from 'react';

export function InstallGuide() {
  return (
    <main className="h-full overflow-y-auto px-5 pb-12 pt-24">
      <article className="mx-auto max-w-xl space-y-6 rounded-3xl bg-white p-6 shadow-sm sm:p-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Install StepFree</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-700">
            Add StepFree to your home screen to open it full screen, like an app.
          </p>
        </div>

        <Steps title="iPhone (Safari)">
          <li>Open StepFree in Safari.</li>
          <li>
            Tap the <strong>Share</strong> button. On newer iOS versions, tap <strong>•••</strong> first, then{' '}
            <strong>Share</strong>.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong>Add</strong>. StepFree appears on your home screen.
          </li>
        </Steps>

        <Steps title="Android (Chrome)">
          <li>Open StepFree in Chrome.</li>
          <li>
            Tap the <strong>⋮</strong> menu in the top corner.
          </li>
          <li>
            Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>. If Chrome shows an install
            banner, you can tap that instead.
          </li>
          <li>
            Tap <strong>Install</strong> to confirm.
          </li>
        </Steps>

        <div className="rounded-2xl bg-slate-50 p-4 text-base text-slate-700">
          <p className="font-semibold text-slate-900">Using StepFree offline</p>
          <p className="mt-1">
            Once installed, StepFree opens even without a connection. Finding a route needs internet, and Live Mode
            needs internet for current TfL lift data.
          </p>
        </div>

        <a href="#/" className="btn-primary text-center">
          Back to the map
        </a>
      </article>
    </main>
  );
}

function Steps({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6 text-lg leading-relaxed text-slate-700 marker:font-semibold marker:text-teal-700">
        {children}
      </ol>
    </section>
  );
}
