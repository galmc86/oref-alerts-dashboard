var MapView = (function () {
  'use strict';

  var map = null;
  var markers = {};
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
    container.innerHTML = '<div id="google-map" style="width: 100%; height: 600px;"></div>';
    
    // Initialize map centered on Israel
    map = new google.maps.Map(document.getElementById('google-map'), {
      center: { lat: 31.5, lng: 34.9 },
      zoom: 8,
      mapTypeId: 'roadmap',
      styles: [
        { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
        { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
      ]
    });

    // Add markers for each region
    CONFIG.REGIONS.forEach(function (region) {
      var coords = COORDINATES[region.name];
      if (!coords) return;

      var circle = new google.maps.Circle({
        map: map,
        center: coords,
        radius: 8000,
        fillColor: '#28a745',
        fillOpacity: 0.6,
        strokeColor: '#fff',
        strokeWeight: 2
      });

      var marker = new google.maps.Marker({
        position: coords,
        map: map,
        title: region.name,
        label: {
          text: region.name,
          color: '#fff',
          fontSize: '11px',
          fontWeight: 'bold'
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0,
        }
      });

      circles[region.name] = circle;
      markers[region.name] = marker;
    });
  }

  function updateRegion(name, isAlerted) {
    var circle = circles[name];
    if (!circle) return;
    
    circle.setOptions({
      fillColor: isAlerted ? '#dc3545' : '#28a745',
      fillOpacity: isAlerted ? 0.8 : 0.6
    });
  }

  return {
    init: init,
    updateRegion: updateRegion
  };
})();
