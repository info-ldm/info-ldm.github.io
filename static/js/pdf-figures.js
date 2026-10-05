import { getDocument, GlobalWorkerOptions } from './vendor/pdfjs/pdf.mjs';

GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

const darkMode = window.matchMedia('(prefers-color-scheme: dark)');

function applyDrawingColors(context, background, foreground) {
  // Remap neutral vector colors without recoloring plots or raster images.
  const channels = color => color.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16));
  const dark = channels(background);
  const light = channels(foreground);
  for (const property of ['fillStyle', 'strokeStyle']) {
    const descriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, property);
    Object.defineProperty(context, property, {
      get() { return descriptor.get.call(this); },
      set(value) {
        descriptor.set.call(this, value);
        const color = descriptor.get.call(this);
        if (!/^#[a-f\d]{6}$/i.test(color)) return;
        const [r, g, b] = channels(color);
        if (r === g && g === b) {
          const mapped = light.map((channel, index) => Math.round(channel + (dark[index] - channel) * r / 255));
          descriptor.set.call(this, `rgb(${mapped.join(',')})`);
        }
      }
    });
  }
  context.fillStyle = foreground;
  context.strokeStyle = foreground;
}

async function initializeFigure(figure) {
  const fallback = figure.querySelector('img');
  try {
    const pdf = await getDocument({ url: new URL(figure.dataset.pdf, document.baseURI).href }).promise;
    const page = await pdf.getPage(1);
    const originalViewport = page.getViewport({ scale: 1 });
    let currentCanvas;
    let renderTask;
    let generation = 0;
    let previousWidth = 0;

    async function render() {
      const width = figure.clientWidth;
      if (!width) return;
      const version = ++generation;
      renderTask?.cancel();

      const viewport = page.getViewport({ scale: width / originalViewport.width });
      const density = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width * density);
      canvas.height = Math.ceil(viewport.height * density);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', figure.dataset.alt || fallback?.alt || 'PDF figure');
      const styles = getComputedStyle(figure);
      const background = styles.getPropertyValue('--background-primary').trim();
      if (darkMode.matches) {
        applyDrawingColors(canvas.getContext('2d'), background, styles.getPropertyValue('--text-primary').trim());
      }

      try {
        renderTask = page.render({
          canvas,
          viewport,
          transform: [density, 0, 0, density, 0, 0],
          background
        });
        await renderTask.promise;
        if (version !== generation) return;
        if (currentCanvas) currentCanvas.replaceWith(canvas);
        else figure.append(canvas);
        currentCanvas = canvas;
        if (fallback) fallback.hidden = true;
      } catch (error) {
        if (error.name !== 'RenderingCancelledException') {
          console.error('PDF figure could not be rendered:', figure.dataset.pdf, error);
        }
      }
    }

    const observer = new ResizeObserver(() => {
      if (figure.clientWidth !== previousWidth) {
        previousWidth = figure.clientWidth;
        render();
      }
    });
    observer.observe(figure);
    darkMode.addEventListener('change', render);
    window.addEventListener('resize', render);
  } catch (error) {
    console.error('PDF figure could not be loaded:', figure.dataset.pdf, error);
  }
}

document.querySelectorAll('.pdf-figure').forEach(initializeFigure);
