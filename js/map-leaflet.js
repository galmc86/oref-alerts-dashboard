var MapView = (function () {
  'use strict';

  var map = null;
  var circles = {};

  // City coordinates (lat, lng)
  var COORDINATES = {
    telaviv:          { lat: 32.0853, lng: 34.7818 },
    beersheva:        { lat: 31.2518, lng: 34.7913 },
    haifa:            { lat: 32.7940, lng: 34.9896 },
    jerusalem:        { lat: 31.7683, lng: 35.2137 },
    nathanya:         { lat: 32.3215, lng: 34.8532 },
    rishonlezion:     { lat: 31.9730, lng: 34.7925 },
    bikatpetah:       { lat: 32.0879, lng: 34.8878 },
    hodhasharon:      { lat: 32.1510, lng: 34.8894 },
    herzliyaramathas: { lat: 32.1624, lng: 34.8443 },
    rehovot:          { lat: 31.8914, lng: 34.8078 },
    krayot:           { lat: 32.8231, lng: 35.0753 },
    ashdod:           { lat: 31.8044, lng: 34.6553 },
    ramlelod:         { lat: 31.9293, lng: 34.8667 },
    hadera:           { lat: 32.4339, lng: 34.9189 },
    eilat:            { lat: 29.5577, lng: 34.9519 },
    modiin:           { lat: 31.8969, lng: 35.0095 },
    ashkelon:         { lat: 31.6688, lng: 34.5742 },
    shoham:           { lat: 32.0167, lng: 34.9500 },
    yokneam:          { lat: 32.6583, lng: 35.1083 },
  };

  function init(container) {
    console.log('MapView init called');
    container.innerHTML = '<div id="leaflet-map" style="width: 100%; height: 600px; background: #ccc;"></div>';
    
    console.log('Creating Leaflet map...');
    // Initialize map centered on Israel
    map = L.map('leaflet-map').setView([31.5, 34.9], 8);
    console.log('Map created:', map);

    // Add CartoDB tiles (alternative provider)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(map);
    console.log('Tiles added');

    // Wait for map to load
    setTimeout(function() {
      map.invalidateSize();
      console.log('Map resized');
    }, 100);

    // Add circles for each region
    CONFIG.REGIONS.forEach(function (region) {
      var coords = COORDINATES[region.name];
      if (!coords) return;

      var circle = L.circle([coords.lat, coords.lng], {
        color: '#fff',
        fillColor: '#28a745',
        fillOpacity: 0.6,
        radius: 8000,
        weight: 2
      }).addTo(map);

      // Add label
      var marker = L.marker([coords.lat, coords.lng], {
        icon: L.divIcon({
          className: 'map-label',
          html: '<div style="color: #fff; font-weight: bold; font-size: 11px; text-shadow: 1px 1px 2px #000;">' + region.name + '</div>',
          iconSize: [100, 20],
          iconAnchor: [50, 10]
        })
      }).addTo(map);

      circle.bindPopup(region.name + '<br>' + region.displayName);

      circles[region.name] = circle;
    });
  }

  function updateRegion(name, isAlerted) {
    var circle = circles[name];
    if (!circle) return;
    
    circle.setStyle({
      fillColor: isAlerted ? '#dc3545' : '#28a745',
      fillOpacity: isAlerted ? 0.8 : 0.6
    });
  }

  return {
    init: init,
    updateRegion: updateRegion
  };
})();
