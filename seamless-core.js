(function (global) {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function curveValue(name, t) {
    t = clamp(t, 0, 1);
    if (name === 'linear') return t;
    if (name === 'cosine') return 0.5 - 0.5 * Math.cos(Math.PI * t);
    return t * t * (3 - 2 * t); // smoothstep
  }

  function mixPixel(a, ai, b, bi, t, dst, di) {
    const inv = 1 - t;
    const aa = a[ai + 3] / 255;
    const ba = b[bi + 3] / 255;
    const outA = aa * inv + ba * t;

    if (outA <= 1e-8) {
      dst[di] = dst[di + 1] = dst[di + 2] = dst[di + 3] = 0;
      return;
    }

    dst[di]     = clamp(Math.round((a[ai]     * aa * inv + b[bi]     * ba * t) / outA), 0, 255);
    dst[di + 1] = clamp(Math.round((a[ai + 1] * aa * inv + b[bi + 1] * ba * t) / outA), 0, 255);
    dst[di + 2] = clamp(Math.round((a[ai + 2] * aa * inv + b[bi + 2] * ba * t) / outA), 0, 255);
    dst[di + 3] = clamp(Math.round(outA * 255), 0, 255);
  }

  function edgeBlend(input, w, h, axis, bx, by, curveName) {
    const out = new Uint8ClampedArray(input);

    if (axis === 'horizontal' || axis === 'both') {
      bx = clamp(Math.floor(bx), 1, Math.max(1, Math.floor(w / 2)));
      const base = new Uint8ClampedArray(out);
      for (let d = 0; d < bx; d++) {
        const t = bx <= 1 ? 0 : d / (bx - 1);
        const keep = curveValue(curveName, t);
        const cross = (1 - keep) * 0.5;
        const lx = d;
        const rx = w - 1 - d;
        for (let y = 0; y < h; y++) {
          const li = (y * w + lx) * 4;
          const ri = (y * w + rx) * 4;
          mixPixel(base, li, base, ri, cross, out, li);
          mixPixel(base, ri, base, li, cross, out, ri);
        }
      }
    }

    if (axis === 'vertical' || axis === 'both') {
      by = clamp(Math.floor(by), 1, Math.max(1, Math.floor(h / 2)));
      const base = new Uint8ClampedArray(out);
      for (let d = 0; d < by; d++) {
        const t = by <= 1 ? 0 : d / (by - 1);
        const keep = curveValue(curveName, t);
        const cross = (1 - keep) * 0.5;
        const ty = d;
        const byy = h - 1 - d;
        for (let x = 0; x < w; x++) {
          const ti = (ty * w + x) * 4;
          const bi = (byy * w + x) * 4;
          mixPixel(base, ti, base, bi, cross, out, ti);
          mixPixel(base, bi, base, ti, cross, out, bi);
        }
      }
    }

    return { data: out, width: w, height: h };
  }

  function edgeMean(data, w, h, side, band) {
    let sr = 0, sg = 0, sb = 0, sw = 0;
    const add = (x, y) => {
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      if (a <= 0) return;
      sr += data[i] * a;
      sg += data[i + 1] * a;
      sb += data[i + 2] * a;
      sw += a;
    };

    if (side === 'left' || side === 'right') {
      band = clamp(Math.floor(band), 1, w);
      const start = side === 'left' ? 0 : w - band;
      for (let y = 0; y < h; y++) for (let x = start; x < start + band; x++) add(x, y);
    } else {
      band = clamp(Math.floor(band), 1, h);
      const start = side === 'top' ? 0 : h - band;
      for (let y = start; y < start + band; y++) for (let x = 0; x < w; x++) add(x, y);
    }

    if (!sw) return [0, 0, 0];
    return [sr / sw, sg / sw, sb / sw];
  }

  function applyToneRamp(data, w, h, axis, bx, by) {
    const out = new Uint8ClampedArray(data);

    if (axis === 'horizontal' || axis === 'both') {
      const left = edgeMean(out, w, h, 'left', bx);
      const right = edgeMean(out, w, h, 'right', bx);
      const diff = [right[0] - left[0], right[1] - left[1], right[2] - left[2]];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (!out[i + 3]) continue;
          const u = w <= 1 ? 0 : x / (w - 1);
          const k = 0.5 - u;
          out[i]     = clamp(Math.round(out[i]     + diff[0] * k), 0, 255);
          out[i + 1] = clamp(Math.round(out[i + 1] + diff[1] * k), 0, 255);
          out[i + 2] = clamp(Math.round(out[i + 2] + diff[2] * k), 0, 255);
        }
      }
    }

    if (axis === 'vertical' || axis === 'both') {
      const top = edgeMean(out, w, h, 'top', by);
      const bottom = edgeMean(out, w, h, 'bottom', by);
      const diff = [bottom[0] - top[0], bottom[1] - top[1], bottom[2] - top[2]];
      for (let y = 0; y < h; y++) {
        const u = h <= 1 ? 0 : y / (h - 1);
        const k = 0.5 - u;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (!out[i + 3]) continue;
          out[i]     = clamp(Math.round(out[i]     + diff[0] * k), 0, 255);
          out[i + 1] = clamp(Math.round(out[i + 1] + diff[1] * k), 0, 255);
          out[i + 2] = clamp(Math.round(out[i + 2] + diff[2] * k), 0, 255);
        }
      }
    }

    return out;
  }

  function offsetFeather(input, w, h, axis, bx, by, curveName) {
    const shiftX = (axis === 'horizontal' || axis === 'both') ? Math.floor(w / 2) : 0;
    const shiftY = (axis === 'vertical' || axis === 'both') ? Math.floor(h / 2) : 0;
    const seamX = shiftX ? w - shiftX : 0;
    const seamY = shiftY ? h - shiftY : 0;
    const shifted = new Uint8ClampedArray(input.length);

    for (let y = 0; y < h; y++) {
      const sy = (y + shiftY) % h;
      for (let x = 0; x < w; x++) {
        const sx = (x + shiftX) % w;
        const si = (sy * w + sx) * 4;
        const di = (y * w + x) * 4;
        shifted[di] = input[si];
        shifted[di + 1] = input[si + 1];
        shifted[di + 2] = input[si + 2];
        shifted[di + 3] = input[si + 3];
      }
    }

    const out = new Uint8ClampedArray(shifted);
    bx = clamp(Math.floor(bx), 1, Math.max(1, Math.floor(w / 2) - 1));
    by = clamp(Math.floor(by), 1, Math.max(1, Math.floor(h / 2) - 1));

    const bandWeight = (coord, seam, band) => {
      const d = Math.max(0, Math.abs((coord + 0.5) - seam) - 0.5);
      if (d >= band) return 0;
      return 1 - curveValue(curveName, d / band);
    };

    for (let y = 0; y < h; y++) {
      const wy = shiftY ? bandWeight(y, seamY, by) : 0;
      for (let x = 0; x < w; x++) {
        const wx = shiftX ? bandWeight(x, seamX, bx) : 0;
        const weight = 1 - (1 - wx) * (1 - wy);
        if (weight <= 0) continue;
        const i = (y * w + x) * 4;
        mixPixel(shifted, i, input, i, weight, out, i);
      }
    }

    return { data: out, width: w, height: h };
  }

  function mirrorTile(input, w, h, axis) {
    const doubleX = axis === 'horizontal' || axis === 'both';
    const doubleY = axis === 'vertical' || axis === 'both';
    const ow = doubleX ? w * 2 : w;
    const oh = doubleY ? h * 2 : h;
    const out = new Uint8ClampedArray(ow * oh * 4);

    for (let y = 0; y < oh; y++) {
      let sy = y;
      if (doubleY && y >= h) sy = (2 * h - 1) - y;
      for (let x = 0; x < ow; x++) {
        let sx = x;
        if (doubleX && x >= w) sx = (2 * w - 1) - x;
        const si = (sy * w + sx) * 4;
        const di = (y * ow + x) * 4;
        out[di] = input[si];
        out[di + 1] = input[si + 1];
        out[di + 2] = input[si + 2];
        out[di + 3] = input[si + 3];
      }
    }

    return { data: out, width: ow, height: oh };
  }

  function process(image, options) {
    const { data, width: w, height: h } = image;
    const axis = options.axis || 'both';
    const algorithm = options.algorithm || 'offset';
    const curve = options.curve || 'smoothstep';
    const bx = options.borderX || Math.max(1, Math.round(w * 0.12));
    const by = options.borderY || Math.max(1, Math.round(h * 0.12));

    if (algorithm === 'mirror') return mirrorTile(data, w, h, axis);
    if (algorithm === 'edge') return edgeBlend(data, w, h, axis, bx, by, curve);
    if (algorithm === 'tone') {
      const corrected = applyToneRamp(data, w, h, axis, bx, by);
      return edgeBlend(corrected, w, h, axis, bx, by, curve);
    }
    return offsetFeather(data, w, h, axis, bx, by, curve);
  }

  global.SeamlessCore = {
    process,
    _test: { curveValue, edgeBlend, offsetFeather, mirrorTile, applyToneRamp }
  };
})(typeof window !== 'undefined' ? window : globalThis);
