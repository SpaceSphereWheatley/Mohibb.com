// tuning.js — dev-only live tuning panel. Dynamically imports Tweakpane (so it
// never loads in normal use) and binds the shared config object; because the
// sim reads config every tick, slider changes take effect immediately. Gated
// by ?debug in main.js.

export async function initTuning(config) {
  const { Pane } = await import('tweakpane');
  const pane = new Pane({ title: 'Sim tuning (?debug)' });
  pane.element.parentElement.style.zIndex = '60';

  const sim = pane.addFolder({ title: 'Clock' });
  sim.addBinding(config, 'dt', { min: 0.02, max: 0.25, step: 0.01 });

  const tyres = pane.addFolder({ title: 'Tyres', expanded: false });
  for (const c of ['SOFT', 'MEDIUM', 'HARD']) {
    tyres.addBinding(config.tyres[c], 'wearRate', { label: `${c} wear`, min: 0.02, max: 0.3, step: 0.005 });
    tyres.addBinding(config.tyres[c], 'degCoeff', { label: `${c} deg`, min: 0.005, max: 0.08, step: 0.002 });
  }
  tyres.addBinding(config.tyres, 'mgmtBand', { min: 0, max: 1, step: 0.05 });

  const fuel = pane.addFolder({ title: 'Fuel', expanded: false });
  fuel.addBinding(config.fuel, 'sPerKgPerLap', { min: 0, max: 0.08, step: 0.005 });
  fuel.addBinding(config.fuel, 'startKg', { min: 0, max: 160, step: 5 });

  const racing = pane.addFolder({ title: 'Racing', expanded: false });
  racing.addBinding(config.race, 'overtakeBase', { min: 0, max: 0.6, step: 0.02 });
  racing.addBinding(config.race, 'dirtyAirPenalty', { min: 0, max: 0.05, step: 0.002 });
  racing.addBinding(config.race, 'drsBonus', { min: 0, max: 0.04, step: 0.002 });

  const strat = pane.addFolder({ title: 'Strategy', expanded: false });
  strat.addBinding(config.strategy, 'pitWearTrigger', { min: 0.5, max: 1.5, step: 0.05 });
  strat.addBinding(config.strategy, 'undercutWear', { min: 0.3, max: 1.2, step: 0.05 });
  strat.addBinding(config.strategy, 'minStintLaps', { min: 1, max: 15, step: 1 });

  return pane;
}
