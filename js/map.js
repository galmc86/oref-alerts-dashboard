var MapView = (function () {
  'use strict';

  var tooltip = null;
  var regionEls = {};

  // Approximate city positions on a simplified Israel map (SVG viewBox 0 0 200 500)
  // x: west-east, y: north-south (inverted: 0=north)
  var POSITIONS = {
    haifa:            { x: 84,  y: 90,  r: 14 },
    krayot:           { x: 92,  y: 82,  r: 12 },
    hadera:           { x: 80,  y: 120, r: 12 },
    nathanya:         { x: 72,  y: 150, r: 13 },
    hodhasharon:      { x: 76,  y: 170, r: 11 },
    herzliyaramathas: { x: 68,  y: 183, r: 12 },
    telaviv:          { x: 64,  y: 200, r: 16 },
    bikatpetah:       { x: 76,  y: 195, r: 12 },
    shoham:           { x: 80,  y: 210, r: 11 },
    modiin:           { x: 84,  y: 225, r: 12 },
    rishonlezion:     { x: 66,  y: 220, r: 13 },
    rehovot:          { x: 70,  y: 235, r: 12 },
    ramlelod:         { x: 76,  y: 225, r: 11 },
    jerusalem:        { x: 94,  y: 240, r: 15 },
    ashdod:           { x: 62,  y: 260, r: 13 },
    beersheva:        { x: 60,  y: 365, r: 15 },
    eilat:            { x: 48,  y: 465, r: 13 },
  };

  // Israel outline - realistic shape
  var OUTLINE = 'M75,5 L85,4 L95,8 L102,15 L108,25 L112,38 L110,52 L105,65 L98,78 L92,90 L88,102 L84,114 L80,126 L76,138 L72,150 L68,162 L64,174 L60,186 L58,198 L58,210 L60,222 L64,234 L68,246 L72,258 L76,270 L79,282 L81,294 L82,306 L82,318 L81,330 L79,342 L76,354 L72,366 L67,378 L61,390 L55,402 L50,414 L46,426 L44,438 L44,450 L46,462 L50,472 L45,470 L40,462 L37,450 L35,436 L34,422 L33,408 L32,394 L31,380 L30,366 L30,352 L31,338 L33,324 L36,310 L40,296 L44,282 L48,268 L52,254 L56,240 L60,226 L64,212 L68,198 L72,184 L76,170 L79,156 L81,142 L82,128 L82,114 L81,100 L79,86 L76,72 L72,58 L68,44 L64,30 L60,16 Z';

  function init(container) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 510');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.style.maxWidth = '400px';
    svg.style.width = '100%';
    svg.style.height = 'auto';

    // Israel outline
    var outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outline.setAttribute('d', OUTLINE);
    outline.setAttribute('fill', '#16213e');
    outline.setAttribute('stroke', '#0f3460');
    outline.setAttribute('stroke-width', '1.5');
    svg.appendChild(outline);

    // Region circles
    CONFIG.REGIONS.forEach(function (region) {
      var pos = POSITIONS[region.name];
      if (!pos) return;

      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-region', region.name);

      var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x);
      circle.setAttribute('cy', pos.y);
      circle.setAttribute('r', pos.r);
      circle.setAttribute('class', 'map-region safe');
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', '1');

      var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', pos.x);
      label.setAttribute('y', pos.y + 2);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '6');
      label.setAttribute('fill', '#fff');
      label.setAttribute('font-weight', 'bold');
      label.setAttribute('font-family', 'Segoe UI, Tahoma, Arial, sans-serif');
      label.textContent = region.name;

      g.appendChild(circle);
      g.appendChild(label);
      svg.appendChild(g);

      regionEls[region.name] = circle;

      // Tooltip on hover
      g.addEventListener('mouseenter', function (e) {
        showTooltip(e, region.displayNameEn + ' (' + region.displayName + ') | ' + region.orefAreaEn);
      });
      g.addEventListener('mouseleave', hideTooltip);
      g.addEventListener('mousemove', moveTooltip);
    });

    container.appendChild(svg);

    // Create tooltip element
    tooltip = document.createElement('div');
    tooltip.className = 'map-tooltip';
    document.body.appendChild(tooltip);
  }

  function updateRegion(name, isAlerted) {
    var el = regionEls[name];
    if (!el) return;
    el.setAttribute('class', isAlerted ? 'map-region alert' : 'map-region safe');
  }

  function showTooltip(e, text) {
    if (!tooltip) return;
    tooltip.textContent = text;
    tooltip.style.display = 'block';
    moveTooltip(e);
  }

  function moveTooltip(e) {
    if (!tooltip) return;
    tooltip.style.left = (e.pageX + 12) + 'px';
    tooltip.style.top = (e.pageY - 30) + 'px';
  }

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.style.display = 'none';
  }

  return {
    init: init,
    updateRegion: updateRegion
  };
})();
