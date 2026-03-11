/**
 * LAZAR Effects Tab — unified SVG pattern generator
 * Merges Halftone + Line Art into one tab with 11 shape options:
 *   Grid: Circle, Square, Diamond, Cross, Triangle, Hexagon, Ring
 *   Lines: Line, Stroke
 *   Radial: Spiral, Polar
 */
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════════
     SHAPE DEFINITIONS
     ═══════════════════════════════════════════════════════════════════ */
  const SHAPES = [
    { id: 'square',   label: 'Square'   },
    { id: 'circle',   label: 'Circle'   },
    { id: 'cross',    label: 'Cross'    },
    { id: 'triangle', label: 'Triangle' },
    { id: 'line',     label: 'Line'     },
    { id: 'spiral',   label: 'Spiral'   },
    { id: 'hexagon',  label: 'Hexagon'  },
    { id: 'ring',     label: 'Ring'     },
    { id: 'stroke',   label: 'Stroke'   },
    { id: 'polar',    label: 'Polar'    },
    { id: 'diamond',  label: 'Diamond'  },
  ];
  const GRID_SHAPES = ['circle','square','diamond','cross','triangle','hexagon','ring'];
  const LINE_SHAPES = ['line','stroke'];

  function shapeType(id) {
    if (GRID_SHAPES.includes(id)) return 'grid';
    if (LINE_SHAPES.includes(id)) return 'line';
    return 'radial';
  }

  /* ═══════════════════════════════════════════════════════════════════
     DEFAULTS
     ═══════════════════════════════════════════════════════════════════ */
  const DEFAULTS = {
    shape: 'circle',
    gridType: 'square',
    angle: 0,
    densityMode: 'count',
    dotCount: 60,
    dotSpacing: 2.5,
    lineCount: 80,
    lineSpacing: 2.0,
    direction: 'vertical',
    waviness: 40,
    spiralTurns: 20,
    spiralArms: 1,
    numRays: 36,
    outputWidth: 150,
    outputHeight: 0,
    units: 'mm',
    minSize: 0,
    maxSize: 2.0,
    blur: 2,
    invert: false,
  };

  /* ═══════════════════════════════════════════════════════════════════
     WEB WORKER
     ═══════════════════════════════════════════════════════════════════ */
  const WORKER_SRC = /* js */`
    'use strict';

    /* ── grayscale ── */
    function toGrayscale(pixels, w, h) {
      var gray = new Float32Array(w * h);
      for (var i = 0; i < w * h; i++) {
        var j = i * 4;
        gray[i] = (0.299 * pixels[j] + 0.587 * pixels[j+1] + 0.114 * pixels[j+2]) / 255;
      }
      return gray;
    }

    /* ── box blur (3-pass ≈ Gaussian) ── */
    function boxBlurPass(src, w, h, r) {
      var tmp = new Float32Array(w * h);
      var dst = new Float32Array(w * h);
      var d = 2 * r + 1;
      for (var y = 0; y < h; y++) {
        var sum = 0;
        for (var k = -r; k <= r; k++) sum += src[y * w + Math.min(w-1, Math.max(0, k))];
        tmp[y * w] = sum / d;
        for (var x = 1; x < w; x++) {
          sum += src[y * w + Math.min(w-1, x + r)] - src[y * w + Math.max(0, x - r - 1)];
          tmp[y * w + x] = sum / d;
        }
      }
      for (var x2 = 0; x2 < w; x2++) {
        var sum2 = 0;
        for (var k2 = -r; k2 <= r; k2++) sum2 += tmp[Math.min(h-1, Math.max(0, k2)) * w + x2];
        dst[x2] = sum2 / d;
        for (var y2 = 1; y2 < h; y2++) {
          sum2 += tmp[Math.min(h-1, y2 + r) * w + x2] - tmp[Math.max(0, y2 - r - 1) * w + x2];
          dst[y2 * w + x2] = sum2 / d;
        }
      }
      return dst;
    }

    function applyBlur(gray, w, h, radius) {
      if (radius <= 0) return gray;
      var r = Math.max(1, Math.round(radius));
      var result = gray;
      for (var pass = 0; pass < 3; pass++) result = boxBlurPass(result, w, h, r);
      return result;
    }

    /* ── bilinear sample ── */
    function sampleBilinear(gray, w, h, x, y) {
      var x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
      var x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
      x0 = Math.min(x0, w - 1); y0 = Math.min(y0, h - 1);
      var fx = x - Math.floor(x), fy = y - Math.floor(y);
      return gray[y0 * w + x0] * (1-fx) * (1-fy) +
             gray[y0 * w + x1] * fx * (1-fy) +
             gray[y1 * w + x0] * (1-fx) * fy +
             gray[y1 * w + x1] * fx * fy;
    }

    /* ── pseudo-random hash for deterministic noise ── */
    function hash(n) {
      n = ((n >> 16) ^ n) * 0x45d9f3b;
      n = ((n >> 16) ^ n) * 0x45d9f3b;
      n = (n >> 16) ^ n;
      return (n & 0x7fffffff) / 0x7fffffff;
    }

    /* ══════════════════════════════════════════════════════════════════
       SHAPE RENDERERS — return SVG element string at (cx, cy) size r
       ══════════════════════════════════════════════════════════════════ */
    function renderShape(shape, cx, cy, r) {
      var r2 = r;
      switch (shape) {
        case 'circle':
          return '<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) +
            '" r="' + r2.toFixed(3) + '"/>';

        case 'square': {
          var s = r2 * 2;
          return '<rect x="' + (cx-r2).toFixed(2) + '" y="' + (cy-r2).toFixed(2) +
            '" width="' + s.toFixed(3) + '" height="' + s.toFixed(3) + '"/>';
        }

        case 'diamond':
          return '<polygon points="' +
            cx.toFixed(2) + ',' + (cy-r2).toFixed(2) + ' ' +
            (cx+r2).toFixed(2) + ',' + cy.toFixed(2) + ' ' +
            cx.toFixed(2) + ',' + (cy+r2).toFixed(2) + ' ' +
            (cx-r2).toFixed(2) + ',' + cy.toFixed(2) + '"/>';

        case 'cross': {
          var arm = r2 * 0.35;
          return '<rect x="' + (cx-arm).toFixed(2) + '" y="' + (cy-r2).toFixed(2) +
            '" width="' + (arm*2).toFixed(3) + '" height="' + (r2*2).toFixed(3) + '"/>' +
            '<rect x="' + (cx-r2).toFixed(2) + '" y="' + (cy-arm).toFixed(2) +
            '" width="' + (r2*2).toFixed(3) + '" height="' + (arm*2).toFixed(3) + '"/>';
        }

        case 'triangle': {
          var sin60 = 0.866;
          return '<polygon points="' +
            cx.toFixed(2) + ',' + (cy - r2).toFixed(2) + ' ' +
            (cx + r2 * sin60).toFixed(2) + ',' + (cy + r2 * 0.5).toFixed(2) + ' ' +
            (cx - r2 * sin60).toFixed(2) + ',' + (cy + r2 * 0.5).toFixed(2) + '"/>';
        }

        case 'hexagon': {
          var pts = [];
          for (var i = 0; i < 6; i++) {
            var a = Math.PI / 3 * i - Math.PI / 6;
            pts.push((cx + r2 * Math.cos(a)).toFixed(2) + ',' +
                     (cy + r2 * Math.sin(a)).toFixed(2));
          }
          return '<polygon points="' + pts.join(' ') + '"/>';
        }

        case 'ring': {
          var outerR = r2, innerR = r2 * 0.5;
          if (innerR < 0.02) innerR = 0.02;
          return '<path d="M' + (cx+outerR).toFixed(2) + ',' + cy.toFixed(2) +
            ' A' + outerR.toFixed(3) + ',' + outerR.toFixed(3) + ' 0 1,1 ' +
            (cx-outerR).toFixed(2) + ',' + cy.toFixed(2) +
            ' A' + outerR.toFixed(3) + ',' + outerR.toFixed(3) + ' 0 1,1 ' +
            (cx+outerR).toFixed(2) + ',' + cy.toFixed(2) +
            ' M' + (cx+innerR).toFixed(2) + ',' + cy.toFixed(2) +
            ' A' + innerR.toFixed(3) + ',' + innerR.toFixed(3) + ' 0 1,0 ' +
            (cx-innerR).toFixed(2) + ',' + cy.toFixed(2) +
            ' A' + innerR.toFixed(3) + ',' + innerR.toFixed(3) + ' 0 1,0 ' +
            (cx+innerR).toFixed(2) + ',' + cy.toFixed(2) +
            'Z" fill-rule="evenodd"/>';
        }

        default:
          return '<circle cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) +
            '" r="' + r2.toFixed(3) + '"/>';
      }
    }

    /* ══════════════════════════════════════════════════════════════════
       GRID GENERATOR — halftone dots on square/hex grid with rotation
       ══════════════════════════════════════════════════════════════════ */
    function generateGrid(gray, imgW, imgH, settings) {
      var outW = settings.outW, outH = settings.outH;
      var minR = settings.minSize / 2, maxR = settings.maxSize / 2;
      var invert = settings.invert;
      var gridType = settings.gridType;
      var dotShape = settings.shape;
      var angleDeg = settings.angle || 0;
      var angleRad = angleDeg * Math.PI / 180;
      var cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

      var spacing;
      if (settings.densityMode === 'count') {
        spacing = outW / Math.max(1, settings.dotCount);
      } else {
        spacing = settings.dotSpacing;
      }

      var cx = outW / 2, cy = outH / 2;
      var SQRT3_2 = 0.8660254;
      var rowSp = gridType === 'hex' ? spacing * SQRT3_2 : spacing;

      var corners = [[0,0],[outW,0],[outW,outH],[0,outH]];
      var gMinX = Infinity, gMaxX = -Infinity;
      var gMinY = Infinity, gMaxY = -Infinity;
      for (var ci = 0; ci < 4; ci++) {
        var dx = corners[ci][0] - cx, dy = corners[ci][1] - cy;
        var lx =  dx * cosA + dy * sinA;
        var ly = -dx * sinA + dy * cosA;
        if (lx < gMinX) gMinX = lx; if (lx > gMaxX) gMaxX = lx;
        if (ly < gMinY) gMinY = ly; if (ly > gMaxY) gMaxY = ly;
      }
      gMinX -= spacing * 1.5; gMinY -= rowSp * 1.5;
      gMaxX += spacing * 1.5; gMaxY += rowSp * 1.5;

      var startCol = Math.floor(gMinX / spacing);
      var endCol   = Math.ceil(gMaxX / spacing);
      var startRow = Math.floor(gMinY / rowSp);
      var endRow   = Math.ceil(gMaxY / rowSp);

      var elements = [];
      var count = 0;

      for (var row = startRow; row <= endRow; row++) {
        for (var col = startCol; col <= endCol; col++) {
          var gx, gy;
          if (gridType === 'hex') {
            gx = col * spacing + ((row & 1) ? spacing * 0.5 : 0);
            gy = row * rowSp;
          } else {
            gx = col * spacing;
            gy = row * spacing;
          }

          var ox = gx * cosA - gy * sinA + cx;
          var oy = gx * sinA + gy * cosA + cy;

          if (ox < -maxR * 3 || ox > outW + maxR * 3 ||
              oy < -maxR * 3 || oy > outH + maxR * 3) continue;

          var ix = (ox / outW) * (imgW - 1);
          var iy = (oy / outH) * (imgH - 1);
          var brightness = 0.5;
          if (ix >= 0 && ix < imgW && iy >= 0 && iy < imgH) {
            brightness = sampleBilinear(gray, imgW, imgH, ix, iy);
          }
          if (invert) brightness = 1 - brightness;

          var darkness = 1 - brightness;
          var r = minR + (maxR - minR) * darkness;
          if (r < 0.01) continue;
          count++;

          var sx = gx + cx, sy = gy + cy;
          elements.push(renderShape(dotShape, sx, sy, r));
        }
      }

      var rotAttr = angleDeg !== 0
        ? ' transform="rotate(' + angleDeg.toFixed(2) + ',' + cx.toFixed(2) + ',' + cy.toFixed(2) + ')"'
        : '';

      var svg = svgHead(outW, outH) +
        '<g clip-path="url(#fx-bounds)"><g' + rotAttr + ' fill="black">' +
        elements.join('') + '</g></g></svg>';

      return { svg: svg, count: count };
    }

    /* ══════════════════════════════════════════════════════════════════
       LINE / STROKE GENERATOR — variable-width filled polygons
       ══════════════════════════════════════════════════════════════════ */
    function generateLines(gray, imgW, imgH, settings) {
      var outW = settings.outW, outH = settings.outH;
      var minW = settings.minSize, maxW = settings.maxSize;
      var invert = settings.invert;
      var isStroke = settings.shape === 'stroke';
      var waviness = (settings.waviness || 0) / 100;

      var angle = 0;
      if (settings.direction === 'horizontal')  angle = Math.PI / 2;
      else if (settings.direction === 'diag-right') angle = Math.PI / 4;
      else if (settings.direction === 'diag-left')  angle = -Math.PI / 4;

      var ldx = Math.sin(angle), ldy = Math.cos(angle);
      var pdx = Math.cos(angle), pdy = -Math.sin(angle);

      var corners = [[0,0],[outW,0],[outW,outH],[0,outH]];
      var minPerp = Infinity, maxPerp = -Infinity;
      var minAlong = Infinity, maxAlong = -Infinity;
      for (var ci = 0; ci < 4; ci++) {
        var cxp = corners[ci][0], cyp = corners[ci][1];
        var p = cxp * pdx + cyp * pdy;
        var a = cxp * ldx + cyp * ldy;
        if (p < minPerp) minPerp = p;   if (p > maxPerp) maxPerp = p;
        if (a < minAlong) minAlong = a;  if (a > maxAlong) maxAlong = a;
      }

      var spacing;
      if (settings.densityMode === 'count') {
        spacing = outW / Math.max(1, settings.lineCount);
      } else {
        spacing = settings.lineSpacing;
      }

      var perpRange = maxPerp - minPerp;
      var numLines = Math.ceil(perpRange / spacing);
      var alongRange = maxAlong - minAlong;
      var sampleStep = Math.max(0.15, alongRange / 600);
      var numSamples = Math.ceil(alongRange / sampleStep) + 1;

      var allPaths = [];

      for (var i = 0; i < numLines; i++) {
        var perpOffset = minPerp + (i + 0.5) * spacing;
        var leftX = new Float64Array(numSamples);
        var leftY = new Float64Array(numSamples);
        var rightX = new Float64Array(numSamples);
        var rightY = new Float64Array(numSamples);
        var validCount = 0;

        for (var s = 0; s < numSamples; s++) {
          var alongOffset = minAlong + s * sampleStep;
          var ox = perpOffset * pdx + alongOffset * ldx;
          var oy = perpOffset * pdy + alongOffset * ldy;

          var ix = (ox / outW) * (imgW - 1);
          var iy = (oy / outH) * (imgH - 1);
          var brightness = 0.5;
          if (ix >= 0 && ix < imgW && iy >= 0 && iy < imgH) {
            brightness = sampleBilinear(gray, imgW, imgH, ix, iy);
          }
          if (invert) brightness = 1 - brightness;

          var darkness = 1 - brightness;
          var halfW = (minW + (maxW - minW) * darkness) / 2;

          if (isStroke) {
            var noise = (hash(i * 10000 + s * 137) - 0.5) * 2;
            halfW *= (1 + noise * waviness);
            if (halfW < 0) halfW = 0;
            var yNoise = (hash(i * 7777 + s * 53) - 0.5) * waviness * spacing * 0.3;
            ox += yNoise * pdx;
            oy += yNoise * pdy;
          }

          leftX[s]  = ox - halfW * pdx;
          leftY[s]  = oy - halfW * pdy;
          rightX[s] = ox + halfW * pdx;
          rightY[s] = oy + halfW * pdy;
          validCount++;
        }
        if (validCount < 2) continue;

        var d = 'M' + leftX[0].toFixed(2) + ',' + leftY[0].toFixed(2);
        for (var p2 = 1; p2 < validCount; p2++) {
          d += 'L' + leftX[p2].toFixed(2) + ',' + leftY[p2].toFixed(2);
        }
        d += 'L' + rightX[validCount-1].toFixed(2) + ',' + rightY[validCount-1].toFixed(2);
        for (var p3 = validCount - 2; p3 >= 0; p3--) {
          d += 'L' + rightX[p3].toFixed(2) + ',' + rightY[p3].toFixed(2);
        }
        d += 'Z';
        allPaths.push(d);
      }

      var svg = svgHead(outW, outH) + '<g clip-path="url(#fx-bounds)">';
      for (var pi = 0; pi < allPaths.length; pi++) {
        svg += '<path d="' + allPaths[pi] + '" fill="black"/>';
      }
      svg += '</g></svg>';

      return { svg: svg, count: numLines };
    }

    /* ══════════════════════════════════════════════════════════════════
       SPIRAL GENERATOR — Archimedean spiral(s) from center
       ══════════════════════════════════════════════════════════════════ */
    function generateSpiral(gray, imgW, imgH, settings) {
      var outW = settings.outW, outH = settings.outH;
      var minW = settings.minSize, maxW = settings.maxSize;
      var invert = settings.invert;
      var turns = settings.spiralTurns || 20;
      var arms  = settings.spiralArms  || 1;
      var cx = outW / 2, cy = outH / 2;
      var maxR = Math.sqrt(cx * cx + cy * cy);
      var totalAngle = turns * Math.PI * 2;
      var rate = maxR / totalAngle;
      var nSamples = Math.max(turns * 80, 400);
      var parts = [];
      var count = 0;

      for (var a = 0; a < arms; a++) {
        var armOffset = (a / arms) * Math.PI * 2;
        var leftEdge = [];
        var rightEdge = [];

        for (var i = 0; i <= nSamples; i++) {
          var t = i / nSamples;
          var theta = t * totalAngle + armOffset;
          var r = rate * theta;
          var px = cx + r * Math.cos(theta);
          var py = cy + r * Math.sin(theta);

          var ix = (px / outW) * (imgW - 1);
          var iy = (py / outH) * (imgH - 1);
          var brightness = 0.5;
          if (ix >= 0 && ix < imgW && iy >= 0 && iy < imgH) {
            brightness = sampleBilinear(gray, imgW, imgH, ix, iy);
          }
          if (invert) brightness = 1 - brightness;
          var darkness = 1 - brightness;
          var halfW = (minW + (maxW - minW) * darkness) / 2;

          var tx = Math.cos(theta) - theta * Math.sin(theta);
          var ty = Math.sin(theta) + theta * Math.cos(theta);
          var tlen = Math.sqrt(tx * tx + ty * ty) || 1;
          var nx = -ty / tlen;
          var ny =  tx / tlen;

          leftEdge.push([(px + nx * halfW), (py + ny * halfW)]);
          rightEdge.push([(px - nx * halfW), (py - ny * halfW)]);
        }

        var d = 'M' + leftEdge[0][0].toFixed(2) + ',' + leftEdge[0][1].toFixed(2);
        for (var j = 1; j < leftEdge.length; j++) {
          d += 'L' + leftEdge[j][0].toFixed(2) + ',' + leftEdge[j][1].toFixed(2);
        }
        for (var k = rightEdge.length - 1; k >= 0; k--) {
          d += 'L' + rightEdge[k][0].toFixed(2) + ',' + rightEdge[k][1].toFixed(2);
        }
        d += 'Z';
        parts.push('<path d="' + d + '" fill="black"/>');
        count++;
      }

      var svg = svgHead(outW, outH) + '<g clip-path="url(#fx-bounds)">' +
        parts.join('') + '</g></svg>';
      return { svg: svg, count: count };
    }

    /* ══════════════════════════════════════════════════════════════════
       POLAR GENERATOR — radial rays from center
       ══════════════════════════════════════════════════════════════════ */
    function generatePolar(gray, imgW, imgH, settings) {
      var outW = settings.outW, outH = settings.outH;
      var minW = settings.minSize, maxW = settings.maxSize;
      var invert = settings.invert;
      var nRays = settings.numRays || 36;
      var cx = outW / 2, cy = outH / 2;
      var maxR = Math.sqrt(cx * cx + cy * cy);
      var nSamples = 120;
      var parts = [];

      for (var i = 0; i < nRays; i++) {
        var angle = (i / nRays) * Math.PI * 2;
        var dx = Math.cos(angle), dy = Math.sin(angle);
        var nx = -dy, ny = dx;
        var leftEdge = [];
        var rightEdge = [];

        for (var j = 0; j <= nSamples; j++) {
          var t = j / nSamples;
          var r = t * maxR;
          var px = cx + r * dx;
          var py = cy + r * dy;

          var ix = (px / outW) * (imgW - 1);
          var iy = (py / outH) * (imgH - 1);
          var brightness = 0.5;
          if (ix >= 0 && ix < imgW && iy >= 0 && iy < imgH) {
            brightness = sampleBilinear(gray, imgW, imgH, ix, iy);
          }
          if (invert) brightness = 1 - brightness;
          var darkness = 1 - brightness;
          var halfW = (minW + (maxW - minW) * darkness) / 2;

          leftEdge.push([(px + nx * halfW), (py + ny * halfW)]);
          rightEdge.push([(px - nx * halfW), (py - ny * halfW)]);
        }

        var d = 'M' + leftEdge[0][0].toFixed(2) + ',' + leftEdge[0][1].toFixed(2);
        for (var k = 1; k < leftEdge.length; k++) {
          d += 'L' + leftEdge[k][0].toFixed(2) + ',' + leftEdge[k][1].toFixed(2);
        }
        for (var k2 = rightEdge.length - 1; k2 >= 0; k2--) {
          d += 'L' + rightEdge[k2][0].toFixed(2) + ',' + rightEdge[k2][1].toFixed(2);
        }
        d += 'Z';
        parts.push('<path d="' + d + '" fill="black"/>');
      }

      var svg = svgHead(outW, outH) + '<g clip-path="url(#fx-bounds)">' +
        parts.join('') + '</g></svg>';
      return { svg: svg, count: nRays };
    }

    /* ── SVG helpers ── */
    function svgHead(w, h) {
      return '<svg xmlns="http://www.w3.org/2000/svg"' +
        ' viewBox="0 0 ' + w.toFixed(2) + ' ' + h.toFixed(2) + '"' +
        ' width="' + w.toFixed(2) + 'mm" height="' + h.toFixed(2) + 'mm">' +
        '<defs><clipPath id="fx-bounds"><rect width="' + w.toFixed(2) +
        '" height="' + h.toFixed(2) + '"/></clipPath></defs>' +
        '<rect width="100%" height="100%" fill="white"/>';
    }

    /* ── message handler ── */
    self.onmessage = function (e) {
      var data = e.data;
      try {
        var pixels = new Uint8ClampedArray(data.pixels);
        var gray = toGrayscale(pixels, data.imgW, data.imgH);
        if (data.settings.blur > 0) {
          gray = applyBlur(gray, data.imgW, data.imgH, data.settings.blur);
        }

        var shape = data.settings.shape;
        var gridShapes = ['circle','square','diamond','cross','triangle','hexagon','ring'];
        var lineShapes = ['line','stroke'];
        var result;

        if (gridShapes.indexOf(shape) >= 0) {
          result = generateGrid(gray, data.imgW, data.imgH, data.settings);
        } else if (lineShapes.indexOf(shape) >= 0) {
          result = generateLines(gray, data.imgW, data.imgH, data.settings);
        } else if (shape === 'spiral') {
          result = generateSpiral(gray, data.imgW, data.imgH, data.settings);
        } else if (shape === 'polar') {
          result = generatePolar(gray, data.imgW, data.imgH, data.settings);
        } else {
          result = generateGrid(gray, data.imgW, data.imgH, data.settings);
        }

        self.postMessage({ ok: true, jobId: data.jobId,
                           svg: result.svg, count: result.count });
      } catch (err) {
        self.postMessage({ ok: false, jobId: data.jobId, error: err.message });
      }
    };
  `;

  /* ─── Worker singleton ──────────────────────────────────────────── */
  let _worker = null, _jobGen = 0;
  function getWorker() {
    if (!_worker) {
      const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
      _worker = new Worker(URL.createObjectURL(blob));
    }
    return _worker;
  }

  /* ═══════════════════════════════════════════════════════════════════
     STATE
     ═══════════════════════════════════════════════════════════════════ */
  const state = {
    settings: { ...DEFAULTS },
    originalImg: null,
    file: null,
    srcPixels: null, srcW: 0, srcH: 0,
    svgString: null,
    outWmm: 0, outHmm: 0,
    processing: false,
  };

  /* ═══════════════════════════════════════════════════════════════════
     CSS
     ═══════════════════════════════════════════════════════════════════ */
  const CSS = `
    .fx-container {
      display: flex; flex-direction: row; flex: 1; min-height: 0;
      background: var(--bg-dark, #0f0f1a);
      color: var(--text-primary, #e0e0e0); overflow: hidden;
    }
    .fx-panel {
      flex: 0 0 280px; background: var(--bg-secondary, #16213e);
      border-right: 1px solid var(--border, #2a2a4a);
      padding: 16px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 0;
    }
    .fx-panel h3 {
      margin: 0 0 14px; font-size: 14px; font-weight: 600;
      letter-spacing: .5px; text-transform: uppercase;
      color: var(--text-secondary, #a0a0c0);
    }

    /* ── Shape grid ── */
    .fx-shape-section { margin-bottom: 14px; }
    .fx-shape-header {
      display: flex; align-items: center; gap: 8px;
      color: var(--text-secondary, #9999b3);
      font-size: 13px; font-weight: 500; margin-bottom: 8px;
    }
    .fx-shape-header svg { opacity: .7; }
    .fx-shape-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;
    }
    .fx-shape-btn {
      padding: 7px 2px; border-radius: var(--radius, 6px);
      background: var(--bg-input, #0f0f23);
      color: var(--text-secondary, #9999b3);
      border: 1px solid var(--border, #2a2a4a);
      font-size: 11px; font-weight: 500; font-family: inherit;
      cursor: pointer; text-align: center;
      transition: all .15s ease;
    }
    .fx-shape-btn:hover {
      border-color: var(--accent, #e94560);
      color: var(--text-primary, #e0e0e0);
    }
    .fx-shape-btn.active {
      background: var(--accent, #e94560);
      border-color: var(--accent, #e94560);
      color: #fff; font-weight: 600;
    }

    /* ── Settings fields ── */
    .fx-field { margin-bottom: 12px; }
    .fx-field label {
      display: block; font-size: 12px;
      color: var(--text-secondary, #a0a0c0);
      margin-bottom: 4px; font-weight: 500;
    }
    .fx-field input[type="text"],
    .fx-field input[type="number"],
    .fx-field select {
      width: 100%; box-sizing: border-box; padding: 7px 10px; font-size: 13px;
      border-radius: var(--radius, 6px);
      border: 1px solid var(--border, #2a2a4a);
      background: var(--bg-input, #0f0f23);
      color: var(--text-primary, #e0e0e0);
      font-family: 'Inter', sans-serif; transition: border-color .2s;
    }
    .fx-field input:focus, .fx-field select:focus {
      border-color: var(--accent, #e94560); outline: none;
    }
    .fx-field .field-hint {
      font-size: 11px; color: var(--text-secondary, #777); margin-top: 3px;
    }
    .fx-row { display: flex; gap: 10px; }
    .fx-row .fx-field { flex: 1; }
    .fx-slider-label {
      display: flex !important; justify-content: space-between; align-items: center;
    }
    .fx-slider-val {
      font-variant-numeric: tabular-nums;
      color: var(--accent, #e94560); font-size: 12px; font-weight: 600;
    }
    .fx-range { width: 100%; margin: 4px 0 2px; }
    .fx-toggle-label {
      display: flex !important; align-items: center; gap: 8px;
      font-size: 12px; cursor: pointer;
    }
    .fx-divider {
      border: none; border-top: 1px solid var(--border, #2a2a4a); margin: 14px 0;
    }

    /* ── Buttons ── */
    .fx-btn {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; padding: 8px 16px; border-radius: var(--radius, 6px);
      font-size: 13px; font-weight: 600; font-family: inherit;
      cursor: pointer; border: 1px solid transparent;
      transition: background .15s, border-color .15s; white-space: nowrap;
    }
    .fx-btn:disabled { opacity: .4; cursor: default; }
    .fx-btn-primary { background: var(--accent, #e94560); color: #fff; }
    .fx-btn-primary:hover:not(:disabled) { filter: brightness(1.15); }
    .fx-btn-secondary {
      background: var(--bg-input, #0f0f23);
      border-color: var(--border, #2a2a4a);
      color: var(--text-primary, #e0e0e0);
    }
    .fx-btn-secondary:hover:not(:disabled) { border-color: var(--accent, #e94560); }
    .fx-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }

    /* ── Option group (Grid type, Direction) ── */
    .fx-opt-group { display: flex; gap: 4px; flex-wrap: wrap; }
    .fx-opt-btn {
      flex: 1; min-width: 52px; padding: 5px 4px;
      font-size: 11px; font-family: inherit; font-weight: 500; text-align: center;
      background: var(--bg-input, #0f0f23);
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-secondary, #a0a0c0); cursor: pointer;
      transition: border-color .15s, color .15s, background .15s;
    }
    .fx-opt-btn:hover {
      border-color: var(--accent, #e94560); color: var(--text-primary, #e0e0e0);
    }
    .fx-opt-btn.active {
      border-color: var(--accent, #e94560);
      background: rgba(233,69,96,.12); color: var(--accent, #e94560);
    }

    /* ── Density toggle ── */
    .fx-density-toggle {
      display: flex; gap: 0; margin-bottom: 8px;
      border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px); overflow: hidden;
    }
    .fx-density-toggle button {
      flex: 1; padding: 5px 8px;
      font-size: 11px; font-family: inherit; font-weight: 500;
      background: transparent; border: none;
      color: var(--text-secondary, #a0a0c0);
      cursor: pointer; transition: background .15s, color .15s;
    }
    .fx-density-toggle button.active {
      background: var(--accent, #e94560); color: #fff;
    }

    /* ── Right area ── */
    .fx-main {
      flex: 1; display: flex; flex-direction: column;
      min-width: 0; min-height: 0; overflow: hidden;
    }
    .fx-preview-area {
      flex: 1; display: flex; gap: 0; min-height: 0; overflow: hidden;
    }
    .fx-preview-box {
      flex: 1; display: flex; flex-direction: column;
      overflow: hidden; border-right: 1px solid var(--border, #2a2a4a);
    }
    .fx-preview-box:last-child { border-right: none; }
    .fx-preview-box .preview-header {
      padding: 8px 12px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .5px;
      color: var(--text-secondary, #a0a0c0);
      border-bottom: 1px solid var(--border, #2a2a4a);
      display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
    }
    .fx-preview-box .preview-header .dim-info {
      font-weight: 400; font-size: 10px; opacity: .7;
    }
    .fx-preview-box .preview-body {
      flex: 1; position: relative; overflow: hidden;
      background: #080812; cursor: grab;
    }
    .fx-preview-box .preview-body.panning { cursor: grabbing; }
    .fx-preview-box .pz-wrap {
      position: absolute; top: 0; left: 0;
      transform-origin: 0 0; will-change: transform;
    }
    .fx-preview-box .pz-wrap canvas,
    .fx-preview-box .pz-wrap img { display: block; image-rendering: auto; }
    .fx-preview-box .pz-hint {
      position: absolute; bottom: 6px; right: 8px;
      font-size: 10px; color: rgba(255,255,255,.3);
      pointer-events: none; user-select: none;
    }
    .fx-empty-preview {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      color: var(--text-secondary, #777); font-size: 13px;
      text-align: center; opacity: .6; pointer-events: none;
      white-space: nowrap; line-height: 1.6;
    }
    .fx-preview-box .orig-drop-active {
      background: rgba(233,69,96,.06);
      outline: 2px dashed var(--accent, #e94560); outline-offset: -4px;
    }
    .fx-preview-box .preview-header .replace-btn {
      display: none; padding: 2px 8px; font-size: 10px; font-family: inherit;
      background: transparent; border: 1px solid var(--border, #2a2a4a);
      border-radius: var(--radius, 6px);
      color: var(--text-secondary, #a0a0c0); cursor: pointer;
      transition: border-color .15s, color .15s;
    }
    .fx-preview-box .preview-header .replace-btn:hover {
      border-color: var(--accent, #e94560); color: var(--text-primary, #e0e0e0);
    }

    /* ── Shape-specific settings show/hide ── */
    .fx-shape-settings { /* wrapper for dynamic sections */ }

    @keyframes fx-spin { to { transform: rotate(360deg); } }
  `;

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    const s = document.createElement('style');
    s.id = 'fx-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
    stylesInjected = true;
  }

  /* ═══════════════════════════════════════════════════════════════════
     HELPERS
     ═══════════════════════════════════════════════════════════════════ */
  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  const pzInstances = {};

  /* ═══════════════════════════════════════════════════════════════════
     UI
     ═══════════════════════════════════════════════════════════════════ */
  function buildUI(container) {
    container.innerHTML = '';
    const s = state.settings;

    /* ── Left: settings panel ── */
    const panel = el('div', 'fx-panel');

    /* ─ Shape grid ─ */
    let shapeBtns = '';
    for (let i = 0; i < SHAPES.length; i++) {
      const sh = SHAPES[i];
      shapeBtns += `<button class="fx-shape-btn ${s.shape === sh.id ? 'active' : ''}"
        data-shape="${sh.id}">${sh.label}</button>`;
    }

    const isGrid   = shapeType(s.shape) === 'grid';
    const isLine   = shapeType(s.shape) === 'line';
    const isSpiral = s.shape === 'spiral';
    const isPolar  = s.shape === 'polar';
    const isStroke = s.shape === 'stroke';

    panel.innerHTML = `
      <h3>Effects</h3>

      <!-- Shape picker -->
      <div class="fx-shape-section">
        <div class="fx-shape-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
          </svg>
          Shape
        </div>
        <div class="fx-shape-grid" id="fx-shape-grid">
          ${shapeBtns}
        </div>
      </div>

      <hr class="fx-divider">

      <!-- GRID settings (Grid type, Angle) -->
      <div id="fx-grid-settings" style="${isGrid ? '' : 'display:none'}">
        <div class="fx-field">
          <label>Grid</label>
          <div class="fx-opt-group" id="fx-grid-type">
            <button class="fx-opt-btn ${s.gridType === 'square' ? 'active' : ''}" data-val="square">Square</button>
            <button class="fx-opt-btn ${s.gridType === 'hex'    ? 'active' : ''}" data-val="hex">Hex</button>
          </div>
        </div>
        <div class="fx-field">
          <label class="fx-slider-label">
            Grid Angle
            <span class="fx-slider-val" id="fx-angle-val">${s.angle}°</span>
          </label>
          <input type="range" id="fx-angle" min="0" max="90" step="1"
            value="${s.angle}" class="fx-range" />
        </div>
      </div>

      <!-- LINE / STROKE settings (Direction) -->
      <div id="fx-line-settings" style="${isLine ? '' : 'display:none'}">
        <div class="fx-field">
          <label>Direction</label>
          <div class="fx-opt-group" id="fx-direction">
            <button class="fx-opt-btn ${s.direction === 'vertical'   ? 'active' : ''}" data-val="vertical">Vertical</button>
            <button class="fx-opt-btn ${s.direction === 'horizontal' ? 'active' : ''}" data-val="horizontal">Horiz</button>
            <button class="fx-opt-btn ${s.direction === 'diag-right' ? 'active' : ''}" data-val="diag-right">Diag ↘</button>
            <button class="fx-opt-btn ${s.direction === 'diag-left'  ? 'active' : ''}" data-val="diag-left">Diag ↗</button>
          </div>
        </div>
        <div class="fx-field" id="fx-waviness-field" style="${isStroke ? '' : 'display:none'}">
          <label class="fx-slider-label">
            Waviness
            <span class="fx-slider-val" id="fx-waviness-val">${s.waviness}%</span>
          </label>
          <input type="range" id="fx-waviness" min="0" max="100" step="1"
            value="${s.waviness}" class="fx-range" />
          <div class="field-hint">Organic hand-drawn variation</div>
        </div>
      </div>

      <!-- SPIRAL settings -->
      <div id="fx-spiral-settings" style="${isSpiral ? '' : 'display:none'}">
        <div class="fx-field">
          <label class="fx-slider-label">
            Turns
            <span class="fx-slider-val" id="fx-spiral-turns-val">${s.spiralTurns}</span>
          </label>
          <input type="range" id="fx-spiral-turns" min="2" max="80" step="1"
            value="${s.spiralTurns}" class="fx-range" />
          <div class="field-hint">Number of rotations from center</div>
        </div>
        <div class="fx-field">
          <label class="fx-slider-label">
            Arms
            <span class="fx-slider-val" id="fx-spiral-arms-val">${s.spiralArms}</span>
          </label>
          <input type="range" id="fx-spiral-arms" min="1" max="8" step="1"
            value="${s.spiralArms}" class="fx-range" />
          <div class="field-hint">Number of spiral arms</div>
        </div>
      </div>

      <!-- POLAR settings -->
      <div id="fx-polar-settings" style="${isPolar ? '' : 'display:none'}">
        <div class="fx-field">
          <label class="fx-slider-label">
            Rays
            <span class="fx-slider-val" id="fx-rays-val">${s.numRays}</span>
          </label>
          <input type="range" id="fx-rays" min="4" max="360" step="1"
            value="${s.numRays}" class="fx-range" />
          <div class="field-hint">Number of radial lines</div>
        </div>
      </div>

      <!-- DENSITY (grid + line shapes) -->
      <div id="fx-density-section" style="${isSpiral || isPolar ? 'display:none' : ''}">
        <div class="fx-field">
          <label>Density</label>
          <div class="fx-density-toggle" id="fx-density-toggle">
            <button class="${s.densityMode === 'count'   ? 'active' : ''}" data-mode="count">${isGrid ? 'Count' : '# Lines'}</button>
            <button class="${s.densityMode === 'spacing' ? 'active' : ''}" data-mode="spacing">Spacing</button>
          </div>
          <div id="fx-count-field" ${s.densityMode !== 'count' ? 'style="display:none"' : ''}>
            <input type="number" id="fx-dot-count" value="${isGrid ? s.dotCount : s.lineCount}"
              min="2" max="1000" step="1" />
            <div class="field-hint" id="fx-count-hint">${isGrid ? 'Dots across the width' : 'Number of lines'}</div>
          </div>
          <div id="fx-spacing-field" ${s.densityMode !== 'spacing' ? 'style="display:none"' : ''}>
            <input type="number" id="fx-dot-spacing" value="${isGrid ? s.dotSpacing : s.lineSpacing}"
              min="0.1" max="50" step="0.1" />
            <div class="field-hint">Spacing between elements (mm)</div>
          </div>
        </div>
      </div>

      <hr class="fx-divider">

      <!-- Output size -->
      <div class="fx-row">
        <div class="fx-field">
          <label>Width</label>
          <input type="number" id="fx-out-width" value="${s.outputWidth || ''}" min="1" step="1" placeholder="150" />
        </div>
        <div class="fx-field">
          <label>Height</label>
          <input type="number" id="fx-out-height" value="${s.outputHeight || ''}" min="1" step="1" placeholder="Auto" />
        </div>
        <div class="fx-field" style="flex:0 0 70px">
          <label>Units</label>
          <select id="fx-units">
            <option value="mm" ${s.units === 'mm' ? 'selected' : ''}>mm</option>
            <option value="in" ${s.units === 'in' ? 'selected' : ''}>inches</option>
          </select>
        </div>
      </div>
      <div class="field-hint" style="margin-bottom:12px">Leave height blank for auto aspect ratio</div>

      <hr class="fx-divider">

      <!-- Min / Max size -->
      <div class="fx-field">
        <label class="fx-slider-label">
          <span id="fx-min-label">${isGrid ? 'Min Dot Size' : 'Min Width'}</span>
          <span class="fx-slider-val" id="fx-min-val">${s.minSize.toFixed(2)} mm</span>
        </label>
        <input type="range" id="fx-min-size" min="0" max="3" step="0.05"
          value="${s.minSize}" class="fx-range" />
        <div class="field-hint" id="fx-min-hint">${isGrid ? 'Smallest dot (bright areas). 0 = invisible.' : 'Thinnest line in bright areas'}</div>
      </div>
      <div class="fx-field">
        <label class="fx-slider-label">
          <span id="fx-max-label">${isGrid ? 'Max Dot Size' : 'Max Width'}</span>
          <span class="fx-slider-val" id="fx-max-val">${s.maxSize.toFixed(2)} mm</span>
        </label>
        <input type="range" id="fx-max-size" min="0.2" max="10" step="0.1"
          value="${s.maxSize}" class="fx-range" />
        <div class="field-hint" id="fx-max-hint">${isGrid ? 'Largest dot (dark areas)' : 'Thickest line in dark areas'}</div>
      </div>

      <!-- Blur -->
      <div class="fx-field">
        <label class="fx-slider-label">
          Blur
          <span class="fx-slider-val" id="fx-blur-val">${s.blur}</span>
        </label>
        <input type="range" id="fx-blur" min="0" max="10" step="1"
          value="${s.blur}" class="fx-range" />
        <div class="field-hint">Smooth source image (reduces noise)</div>
      </div>

      <!-- Invert -->
      <div class="fx-field">
        <label class="fx-toggle-label">
          <input type="checkbox" id="fx-invert" ${s.invert ? 'checked' : ''} />
          Invert
        </label>
      </div>

      <!-- Actions -->
      <div class="fx-actions">
        <button class="fx-btn fx-btn-primary" id="fx-process-btn" disabled>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Generate
        </button>
        <button class="fx-btn fx-btn-secondary" id="fx-download-btn" style="display:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download SVG
        </button>
      </div>
      <div id="fx-status"></div>
    `;
    container.appendChild(panel);

    /* ── Right: preview area ── */
    const main = el('div', 'fx-main');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/webp';
    fileInput.style.display = 'none';
    fileInput.id = 'fx-file-input';
    main.appendChild(fileInput);

    const previewArea = el('div', 'fx-preview-area');

    const origBox = el('div', 'fx-preview-box');
    origBox.innerHTML = `
      <div class="preview-header">
        <span>Original</span>
        <span style="flex:1"></span>
        <span class="dim-info" id="fx-orig-info"></span>
        <button class="replace-btn" id="fx-replace-btn">Replace</button>
      </div>
      <div class="preview-body" id="fx-orig-body">
        <div class="pz-wrap" id="fx-orig-wrap"></div>
        <div class="fx-empty-preview" id="fx-orig-empty">Click or drop an image<br>to begin</div>
        <span class="pz-hint">Scroll to zoom · Drag to pan · Dbl-click to reset</span>
      </div>
    `;

    const resultBox = el('div', 'fx-preview-box');
    resultBox.innerHTML = `
      <div class="preview-header">
        <span>Result SVG</span>
        <span style="flex:1"></span>
        <span class="dim-info" id="fx-result-info"></span>
      </div>
      <div class="preview-body" id="fx-result-body">
        <div class="pz-wrap" id="fx-result-wrap"></div>
        <div class="fx-empty-preview" id="fx-result-empty">Generated SVG will appear here</div>
        <span class="pz-hint">Scroll to zoom · Drag to pan · Dbl-click to reset</span>
      </div>
    `;

    previewArea.appendChild(origBox);
    previewArea.appendChild(resultBox);
    main.appendChild(previewArea);
    container.appendChild(main);

    wireEvents();
  }

  /* ═══════════════════════════════════════════════════════════════════
     PAN / ZOOM
     ═══════════════════════════════════════════════════════════════════ */
  function setupPanZoom(bodyEl, wrapEl) {
    let scale = 1, tx = 0, ty = 0;
    let dragging = false, lastX = 0, lastY = 0;

    function apply() {
      wrapEl.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    }

    function fit() {
      const child = wrapEl.firstElementChild;
      if (!child) return;
      const bw = bodyEl.clientWidth, bh = bodyEl.clientHeight;
      let cw, ch;
      if (child.tagName === 'IMG' || child.tagName === 'CANVAS') {
        cw = child.naturalWidth  || child.width  || bw;
        ch = child.naturalHeight || child.height || bh;
      } else {
        cw = child.clientWidth  || bw;
        ch = child.clientHeight || bh;
      }
      if (!cw || !ch) return;
      scale = Math.min(bw / cw, bh / ch);
      tx = (bw - cw * scale) / 2;
      ty = (bh - ch * scale) / 2;
      apply();
    }

    bodyEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = bodyEl.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const ns = Math.min(Math.max(scale * factor, 0.02), 80);
      tx = mx - (mx - tx) * (ns / scale);
      ty = my - (my - ty) * (ns / scale);
      scale = ns;
      apply();
    }, { passive: false });

    bodyEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      bodyEl.classList.add('panning');
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      tx += e.clientX - lastX; ty += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      apply();
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      bodyEl.classList.remove('panning');
    });
    bodyEl.addEventListener('dblclick', fit);

    let lastDist = 0;
    bodyEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        dragging = true; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        dragging = false;
        lastDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    bodyEl.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && dragging) {
        tx += e.touches[0].clientX - lastX; ty += e.touches[0].clientY - lastY;
        lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
        apply();
      } else if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY);
        const f = dist / (lastDist || dist); lastDist = dist;
        const r = bodyEl.getBoundingClientRect();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
        const ns = Math.min(Math.max(scale * f, 0.02), 80);
        tx = cx - (cx - tx) * (ns / scale);
        ty = cy - (cy - ty) * (ns / scale);
        scale = ns; apply();
      }
    }, { passive: false });
    bodyEl.addEventListener('touchend', () => { dragging = false; });

    return { fit, apply };
  }

  /* ═══════════════════════════════════════════════════════════════════
     WIRE EVENTS
     ═══════════════════════════════════════════════════════════════════ */
  function wireEvents() {
    const fileInput   = document.getElementById('fx-file-input');
    const processBtn  = document.getElementById('fx-process-btn');
    const downloadBtn = document.getElementById('fx-download-btn');
    const origBody    = document.getElementById('fx-orig-body');

    // Upload
    origBody.addEventListener('click', () => {
      if (state.originalImg) return;
      fileInput.click();
    });
    origBody.style.cursor = 'pointer';

    document.getElementById('fx-replace-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) handleFile(fileInput.files[0]);
    });

    // Drag & drop
    origBody.addEventListener('dragover', (e) => {
      e.preventDefault(); origBody.classList.add('orig-drop-active');
    });
    origBody.addEventListener('dragleave', () => origBody.classList.remove('orig-drop-active'));
    origBody.addEventListener('drop', (e) => {
      e.preventDefault(); origBody.classList.remove('orig-drop-active');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    processBtn.addEventListener('click', () => {
      if (!state.originalImg || state.processing) return;
      readSettings();
      runProcessing();
    });
    downloadBtn.addEventListener('click', downloadResult);

    // Pan/zoom
    pzInstances.orig   = setupPanZoom(origBody, document.getElementById('fx-orig-wrap'));
    pzInstances.result = setupPanZoom(
      document.getElementById('fx-result-body'),
      document.getElementById('fx-result-wrap'));

    // ── Debounced live update ──
    let liveTimer = null;
    function scheduleLiveUpdate() {
      if (!state.originalImg) return;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => { readSettings(); runProcessing(); }, 200);
    }

    // ── Shape grid ──
    document.querySelectorAll('#fx-shape-grid .fx-shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#fx-shape-grid .fx-shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.shape = btn.dataset.shape;
        updateVisibleSettings();
        scheduleLiveUpdate();
      });
    });

    // ── Option groups ──
    function wireOptGroup(groupId) {
      document.querySelectorAll(`#${groupId} .fx-opt-btn`).forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll(`#${groupId} .fx-opt-btn`).forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          scheduleLiveUpdate();
        });
      });
    }
    wireOptGroup('fx-grid-type');
    wireOptGroup('fx-direction');

    // Density toggle
    document.querySelectorAll('#fx-density-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#fx-density-toggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        document.getElementById('fx-count-field').style.display   = mode === 'count'   ? '' : 'none';
        document.getElementById('fx-spacing-field').style.display = mode === 'spacing' ? '' : 'none';
        scheduleLiveUpdate();
      });
    });

    // Number inputs
    ['fx-dot-count','fx-dot-spacing','fx-out-width','fx-out-height'].forEach(id => {
      document.getElementById(id).addEventListener('change', scheduleLiveUpdate);
    });
    document.getElementById('fx-units').addEventListener('change', scheduleLiveUpdate);

    // Sliders
    function wireSlider(id, displayId, suffix, toFixed) {
      const slider = document.getElementById(id);
      if (!slider) return;
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        document.getElementById(displayId).textContent =
          (toFixed !== undefined ? v.toFixed(toFixed) : v) + (suffix || '');
        scheduleLiveUpdate();
      });
    }
    wireSlider('fx-angle', 'fx-angle-val', '°');
    wireSlider('fx-min-size', 'fx-min-val', ' mm', 2);
    wireSlider('fx-max-size', 'fx-max-val', ' mm', 2);
    wireSlider('fx-blur', 'fx-blur-val', '');
    wireSlider('fx-waviness', 'fx-waviness-val', '%');
    wireSlider('fx-spiral-turns', 'fx-spiral-turns-val', '');
    wireSlider('fx-spiral-arms', 'fx-spiral-arms-val', '');
    wireSlider('fx-rays', 'fx-rays-val', '');

    // Invert
    document.getElementById('fx-invert').addEventListener('change', scheduleLiveUpdate);
  }

  /* ── Update visible settings based on shape ── */
  function updateVisibleSettings() {
    const shape = state.settings.shape;
    const st = shapeType(shape);
    const isGrid = st === 'grid';
    const isLine = st === 'line';

    document.getElementById('fx-grid-settings').style.display   = isGrid ? '' : 'none';
    document.getElementById('fx-line-settings').style.display   = isLine ? '' : 'none';
    document.getElementById('fx-spiral-settings').style.display = shape === 'spiral' ? '' : 'none';
    document.getElementById('fx-polar-settings').style.display  = shape === 'polar'  ? '' : 'none';
    document.getElementById('fx-density-section').style.display =
      (shape === 'spiral' || shape === 'polar') ? 'none' : '';

    // Waviness only for stroke
    const wavField = document.getElementById('fx-waviness-field');
    if (wavField) wavField.style.display = shape === 'stroke' ? '' : 'none';

    // Update min/max labels
    const sizeLabel = isGrid ? 'Dot Size' : 'Width';
    document.getElementById('fx-min-label').textContent = 'Min ' + sizeLabel;
    document.getElementById('fx-max-label').textContent = 'Max ' + sizeLabel;
    document.getElementById('fx-min-hint').textContent  = isGrid
      ? 'Smallest dot (bright areas). 0 = invisible.'
      : 'Thinnest line in bright areas';
    document.getElementById('fx-max-hint').textContent  = isGrid
      ? 'Largest dot (dark areas)'
      : 'Thickest line in dark areas';

    // Update density toggle labels
    const countBtn = document.querySelector('#fx-density-toggle button[data-mode="count"]');
    if (countBtn) countBtn.textContent = isGrid ? 'Count' : '# Lines';
    const countHint = document.getElementById('fx-count-hint');
    if (countHint) countHint.textContent = isGrid ? 'Dots across the width' : 'Number of lines';
  }

  /* ═══════════════════════════════════════════════════════════════════
     FILE HANDLING
     ═══════════════════════════════════════════════════════════════════ */
  function handleFile(file) {
    if (!file.type.match(/image\/(jpeg|png|webp)/)) return;
    state.file = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.originalImg = img;
        state.svgString = null;
        state.srcPixels = null;

        const origWrap = document.getElementById('fx-orig-wrap');
        origWrap.innerHTML = '';
        const oc = document.createElement('canvas');
        oc.width = img.naturalWidth; oc.height = img.naturalHeight;
        oc.getContext('2d').drawImage(img, 0, 0);
        origWrap.appendChild(oc);
        document.getElementById('fx-orig-empty').style.display = 'none';
        document.getElementById('fx-orig-info').textContent =
          `${img.naturalWidth} × ${img.naturalHeight} px`;

        requestAnimationFrame(() => pzInstances.orig && pzInstances.orig.fit());

        document.getElementById('fx-process-btn').disabled = false;
        document.getElementById('fx-result-wrap').innerHTML = '';
        document.getElementById('fx-result-empty').style.display = '';
        document.getElementById('fx-result-info').textContent = '';
        document.getElementById('fx-download-btn').style.display = 'none';

        document.getElementById('fx-orig-body').style.cursor = '';
        document.getElementById('fx-replace-btn').style.display = 'inline-block';

        readSettings();
        runProcessing();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ═══════════════════════════════════════════════════════════════════
     READ SETTINGS
     ═══════════════════════════════════════════════════════════════════ */
  function readSettings() {
    const s = state.settings;

    // Shape
    const activeShape = document.querySelector('#fx-shape-grid .fx-shape-btn.active');
    s.shape = activeShape ? activeShape.dataset.shape : 'circle';

    const st = shapeType(s.shape);

    // Grid settings
    if (st === 'grid') {
      const gt = document.querySelector('#fx-grid-type .fx-opt-btn.active');
      s.gridType = gt ? gt.dataset.val : 'square';
      s.angle = parseInt(document.getElementById('fx-angle').value, 10) || 0;
    }

    // Line/Stroke settings
    if (st === 'line') {
      const dir = document.querySelector('#fx-direction .fx-opt-btn.active');
      s.direction = dir ? dir.dataset.val : 'vertical';
      s.waviness = parseInt(document.getElementById('fx-waviness').value, 10) || 0;
    }

    // Spiral settings
    if (s.shape === 'spiral') {
      s.spiralTurns = parseInt(document.getElementById('fx-spiral-turns').value, 10) || 20;
      s.spiralArms  = parseInt(document.getElementById('fx-spiral-arms').value, 10) || 1;
    }

    // Polar settings
    if (s.shape === 'polar') {
      s.numRays = parseInt(document.getElementById('fx-rays').value, 10) || 36;
    }

    // Density
    if (s.shape !== 'spiral' && s.shape !== 'polar') {
      const dm = document.querySelector('#fx-density-toggle button.active');
      s.densityMode = dm ? dm.dataset.mode : 'count';
      const countVal = parseInt(document.getElementById('fx-dot-count').value, 10);
      const spacVal  = parseFloat(document.getElementById('fx-dot-spacing').value);
      if (st === 'grid') {
        s.dotCount   = countVal || 60;
        s.dotSpacing = spacVal || 2.5;
      } else {
        s.lineCount   = countVal || 80;
        s.lineSpacing = spacVal || 2.0;
      }
    }

    // Output size
    const wVal = parseFloat(document.getElementById('fx-out-width').value);
    const hVal = parseFloat(document.getElementById('fx-out-height').value);
    s.outputWidth  = wVal > 0 ? wVal : 150;
    s.outputHeight = hVal > 0 ? hVal : 0;
    s.units  = document.getElementById('fx-units').value;

    // Min/Max, Blur, Invert
    s.minSize = parseFloat(document.getElementById('fx-min-size').value) || 0;
    s.maxSize = parseFloat(document.getElementById('fx-max-size').value) || 2.0;
    s.blur    = parseInt(document.getElementById('fx-blur').value, 10) || 0;
    s.invert  = document.getElementById('fx-invert').checked;
  }

  /* ═══════════════════════════════════════════════════════════════════
     PROCESSING
     ═══════════════════════════════════════════════════════════════════ */
  function runProcessing() {
    if (!state.originalImg) return;

    if (!state.srcPixels) {
      const tmp = document.createElement('canvas');
      tmp.width  = state.originalImg.naturalWidth  || state.originalImg.width;
      tmp.height = state.originalImg.naturalHeight || state.originalImg.height;
      tmp.getContext('2d').drawImage(state.originalImg, 0, 0);
      state.srcPixels = tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height).data;
      state.srcW = tmp.width;
      state.srcH = tmp.height;
    }

    const s = state.settings;
    let outW = s.outputWidth, outH = s.outputHeight;
    if (s.units === 'in') { outW *= 25.4; outH *= 25.4; }

    const aspect = state.srcH / state.srcW;
    if (!outH || outH <= 0) outH = outW * aspect;
    if (!outW || outW <= 0) outW = outH / aspect;

    state.outWmm = outW;
    state.outHmm = outH;

    let spacingMM = (shapeType(s.shape) === 'grid') ? s.dotSpacing : s.lineSpacing;
    if (s.units === 'in' && s.densityMode === 'spacing') spacingMM *= 25.4;

    const jobId = ++_jobGen;
    state.processing = true;

    const pixelsCopy = new Uint8ClampedArray(state.srcPixels).buffer;
    const worker = getWorker();

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.jobId !== _jobGen) return;

      state.processing = false;
      document.getElementById('fx-process-btn').disabled = false;

      if (!msg.ok) {
        console.error('Effects worker error:', msg.error);
        document.getElementById('fx-status').innerHTML =
          `<div style="color:#ef5350;padding:8px 0;font-size:13px">Error: ${msg.error}</div>`;
        return;
      }

      state.svgString = msg.svg;
      showResult(msg.count);
      document.getElementById('fx-status').innerHTML = '';
    };

    worker.postMessage({
      pixels: pixelsCopy, imgW: state.srcW, imgH: state.srcH,
      settings: {
        shape: s.shape,
        gridType: s.gridType, angle: s.angle,
        densityMode: s.densityMode,
        dotCount: s.dotCount, dotSpacing: spacingMM,
        lineCount: s.lineCount, lineSpacing: spacingMM,
        direction: s.direction, waviness: s.waviness,
        spiralTurns: s.spiralTurns, spiralArms: s.spiralArms,
        numRays: s.numRays,
        outW, outH,
        minSize: s.minSize, maxSize: s.maxSize,
        blur: s.blur, invert: s.invert,
      },
      jobId
    }, [pixelsCopy]);
  }

  /* ═══════════════════════════════════════════════════════════════════
     SHOW RESULT
     ═══════════════════════════════════════════════════════════════════ */
  function showResult(elemCount) {
    const wrapEl = document.getElementById('fx-result-wrap');
    const isEmpty = !wrapEl.firstElementChild;

    const blob = new Blob([state.svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      wrapEl.innerHTML = '';
      wrapEl.appendChild(img);
      if (isEmpty) {
        requestAnimationFrame(() => pzInstances.result && pzInstances.result.fit());
      }
    };
    img.src = url;

    document.getElementById('fx-result-empty').style.display = 'none';

    const s = state.settings;
    const uW = s.units === 'in' ? (state.outWmm / 25.4).toFixed(2) + '"' : state.outWmm.toFixed(1) + 'mm';
    const uH = s.units === 'in' ? (state.outHmm / 25.4).toFixed(2) + '"' : state.outHmm.toFixed(1) + 'mm';
    const label = shapeType(s.shape) === 'grid' ? 'elements' : (s.shape === 'spiral' ? 'arms' : 'lines');
    document.getElementById('fx-result-info').textContent =
      `${uW} × ${uH}  |  ${elemCount} ${label}`;

    document.getElementById('fx-download-btn').style.display = '';
  }

  /* ═══════════════════════════════════════════════════════════════════
     DOWNLOAD
     ═══════════════════════════════════════════════════════════════════ */
  function downloadResult() {
    if (!state.svgString) return;

    const s = state.settings;
    const stem = state.file?.name ? state.file.name.replace(/\.[^.]+$/, '') : 'image';

    const sizeTag = s.units === 'in'
      ? `${(state.outWmm / 25.4).toFixed(1)}x${(state.outHmm / 25.4).toFixed(1)}in`
      : `${state.outWmm.toFixed(0)}x${state.outHmm.toFixed(0)}mm`;

    let detailTag = '';
    const st = shapeType(s.shape);

    if (st === 'grid') {
      const densityTag = s.densityMode === 'count' ? `${s.dotCount}dots` : `${s.dotSpacing}sp`;
      const angleTag = s.angle > 0 ? `_${s.angle}deg` : '';
      detailTag = `${s.gridType}_${s.shape}${angleTag}_${densityTag}`;
    } else if (st === 'line') {
      const densityTag = s.densityMode === 'count' ? `${s.lineCount}lines` : `${s.lineSpacing}sp`;
      detailTag = `${s.shape}_${s.direction}_${densityTag}`;
    } else if (s.shape === 'spiral') {
      detailTag = `spiral_${s.spiralTurns}t_${s.spiralArms}arm`;
    } else if (s.shape === 'polar') {
      detailTag = `polar_${s.numRays}rays`;
    }

    const filename = `${stem}_fx_${detailTag}_${sizeTag}_s${s.minSize.toFixed(1)}-${s.maxSize.toFixed(1)}.svg`;

    const blob = new Blob([state.svgString], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ═══════════════════════════════════════════════════════════════════
     TAB INJECTION
     ═══════════════════════════════════════════════════════════════════ */
  let effectsTab = null;
  let effectsBody = null;
  let isActive = false;

  function injectTab() {
    const navTabs = document.querySelector('.nav-tabs');
    if (!navTabs || navTabs.querySelector('.effects-tab')) return;

    effectsTab = document.createElement('button');
    effectsTab.className = 'nav-tab effects-tab';
    effectsTab.textContent = 'Effects';
    effectsTab.addEventListener('click', activateEffects);
    navTabs.appendChild(effectsTab);

    if (isActive) {
      effectsTab.classList.add('active');
      navTabs.querySelectorAll('.nav-tab:not(.effects-tab)').forEach(t => {
        t.classList.remove('active');
      });
    }
  }

  function ensureBody() {
    if (effectsBody) return;
    const app = document.querySelector('.app');
    if (!app) return;

    injectStyles();
    effectsBody = el('div', 'fx-container');
    effectsBody.style.display = 'none';
    app.appendChild(effectsBody);
    buildUI(effectsBody);
  }

  function activateEffects() {
    isActive = true;
    ensureBody();

    // Hide React content AND other injected tabs' content
    // Note: 3dengrave.js replaces .app-body-3d class with .engrave3d-container
    document.querySelectorAll('.app-body, .app-body-3d, .engrave3d-container, .step-toolbar, .halftone-container, .lineart-container').forEach(e => {
      e.style.setProperty('display', 'none', 'important');
    });

    document.querySelectorAll('.nav-tabs .nav-tab').forEach(t => t.classList.remove('active'));
    if (effectsTab) effectsTab.classList.add('active');
    if (effectsBody) effectsBody.style.display = 'flex';
  }

  function deactivateEffects() {
    if (!isActive) return;
    isActive = false;

    if (effectsBody) effectsBody.style.display = 'none';

    document.querySelectorAll('.app-body, .app-body-3d, .engrave3d-container, .step-toolbar').forEach(e => {
      e.style.removeProperty('display');
    });
    if (effectsTab) effectsTab.classList.remove('active');
  }

  // Capture-phase click intercept for non-effects tabs
  document.addEventListener('click', (e) => {
    if (!isActive) return;
    if (e.target.closest('.nav-tab:not(.effects-tab)')) {
      deactivateEffects();
    }
  }, true);

  /* ═══════════════════════════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════════════════════════ */
  const observer = new MutationObserver(() => {
    injectTab();
  });

  function init() {
    injectTab();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
