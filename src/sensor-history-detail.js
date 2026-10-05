import {
  formatClockDateTime,
  formatReadingNumber,
  getClockFaceTimeOptions,
  getSensorPrecision,
  joinUnit,
} from './format.js';
import { isolateLtr, t } from './i18n.js';

function summarizeHistory(series) {
  const values = series.map((point) => point.value).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce(
    (result, value) => ({
      min: Math.min(result.min, value),
      max: Math.max(result.max, value),
      average: result.average + value / values.length,
    }),
    { min: Infinity, max: -Infinity, average: 0 }
  );
}

function mountSensorHistoryDetail({ body, modal, entity, websocket, normalize, render }) {
  const controls = document.createElement('div');
  controls.className = 'sensor-history-controls';
  // A sensor that dropped out still has a history to read, so the unavailable dialog leaves these on.
  controls.dataset.unavailableKeep = 'true';
  const label = document.createElement('label');
  label.textContent = t('History period');
  const periodSelect = document.createElement('select');
  periodSelect.className = 'form-control';
  [
    [1, '1 hour'],
    [6, '6 hours'],
    [24, '24 hours'],
    [168, '7 days'],
  ].forEach(([hours, text]) => {
    periodSelect.add(new Option(t(text), String(hours)));
  });
  periodSelect.value = '24';
  label.append(periodSelect);
  const refresh = document.createElement('button');
  refresh.className = 'btn btn-secondary';
  refresh.textContent = t('Refresh');
  controls.append(label, refresh);
  const status = document.createElement('p');
  status.className = 'sensor-history-summary';
  status.setAttribute('role', 'status');
  const frame = document.createElement('div');
  frame.className = 'sensor-detail-sparkline';
  frame.hidden = true;
  const dates = document.createElement('p');
  dates.className = 'sensor-history-summary';
  body.append(controls, status, frame, dates);
  let revision = 0;
  // Switching periods reuses a recent response; older ones are refetched so the chart does not
  // present a stale window as current.
  const CACHE_TTL = 60000;
  const cache = new Map();
  const load = async (force = false) => {
    const requestRevision = ++revision;
    const hours = Number(periodSelect.value);
    status.textContent = t('Loading history...');
    // Keep the previous chart and date range in place while loading so the dialog keeps its
    // height instead of collapsing and re-centring on every request.
    frame.classList.add('is-loading');
    frame.setAttribute('aria-busy', 'true');
    // aria-disabled rather than disabled: disabling the focused button would drop focus to
    // <body>, where Escape and the dialog's focus trap no longer work.
    refresh.setAttribute('aria-disabled', 'true');
    try {
      let data = cache.get(hours);
      if (force || !data || Date.now() - data.end > CACHE_TTL) {
        const end = Date.now();
        const start = end - hours * 3600000;
        const response = await websocket.request({
          type: 'history/history_during_period',
          start_time: new Date(start).toISOString(),
          end_time: new Date(end).toISOString(),
          entity_ids: [entity.entity_id],
          minimal_response: true,
          no_attributes: true,
          include_start_time_state: true,
          significant_changes_only: false,
        });
        if (response?.success === false)
          throw new Error(response.error?.message || 'History request failed');
        const series = normalize(response, entity.entity_id)
          .filter((point) => Number.isFinite(point.timestamp) && point.timestamp <= end)
          .map((point) => ({ ...point, timestamp: Math.max(start, point.timestamp) }));
        data = { series, start, end };
        cache.set(hours, data);
      }
      if (!modal.isConnected || revision !== requestRevision) return;
      const stats = summarizeHistory(data.series);
      if (!stats) {
        status.textContent = t('No recorded values in this period.');
        frame.hidden = true;
        dates.textContent = '';
        // The request went through, so the button is no longer a Retry.
        refresh.textContent = t('Refresh');
        return;
      }
      // Every figure carries its unit and the precision the headline reading uses, so the summary
      // cannot read as if only the average had a unit, or give "20.66" beside a "20.7 °C" readout.
      // Each figure is a piece of its own that wraps as a whole, so a line never ends between
      // "Sample average" and its value.
      const unit = entity.attributes?.unit_of_measurement;
      const precision = getSensorPrecision(entity.attributes);
      const format = (value) => isolateLtr(joinUnit(formatReadingNumber(value, precision), unit));
      const figures = [
        t('Minimum {{value}}', { value: format(stats.min) }),
        t('Maximum {{value}}', { value: format(stats.max) }),
        t('Sample average {{value}}', { value: format(stats.average) }),
      ].map((text) => {
        const figure = document.createElement('span');
        figure.className = 'sensor-history-figure';
        figure.textContent = text;
        return figure;
      });
      status.replaceChildren(
        ...figures.flatMap((figure, index) => (index ? [' · ', figure] : [figure]))
      );
      frame.hidden = false;
      render(frame, data.series, { start: data.start, end: data.end });
      // Minutes are precise enough for a history period; seconds only add noise.
      const period = {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        ...getClockFaceTimeOptions(),
      };
      dates.textContent = `${formatClockDateTime(data.start, period)} – ${formatClockDateTime(data.end, period)}`;
      refresh.textContent = t('Refresh');
    } catch (error) {
      console.warn('Sensor history request failed:', error);
      if (!modal.isConnected || revision !== requestRevision) return;
      status.textContent = t(
        'Could not load history. Check your connection and recorder, then retry.'
      );
      // The previous chart and dates belong to another period; don't show them under this one.
      frame.hidden = true;
      dates.textContent = '';
      refresh.textContent = t('Retry');
    } finally {
      if (revision === requestRevision) {
        refresh.removeAttribute('aria-disabled');
        frame.classList.remove('is-loading');
        frame.removeAttribute('aria-busy');
      }
    }
  };
  periodSelect.onchange = () => void load();
  refresh.onclick = () => {
    if (refresh.getAttribute('aria-disabled') !== 'true') void load(true);
  };
  void load();
}

export { summarizeHistory, mountSensorHistoryDetail };
