class Node {
  constructor(nodeId_, lat_, lon_) {
    this.nodeId = nodeId_;
    this.lat = lat_;
    this.lon = lon_;
    // We no longer calculate this.x and this.y here because they change on zoom
    this.edges = [];
  }

// Helper function to get the current screen position
  getScreenPos() {
    const lon = parseFloat(this.lon);
    const lat = parseFloat(this.lat);
    if (isNaN(lon) || isNaN(lat)) return { x: -1000, y: -1000 };

    // Convert Lat/Lon to the map's internal "Meters" projection
    const coords = ol.proj.fromLonLat([lon, lat]);
    
    // Get the exact pixel on the screen
    const pix = openlayersmap.getPixelFromCoordinate(coords);
    
    if (pix) {
        // IMPORTANT: We must subtract the map's container position 
        // if your canvas is offset by a header
        return { x: pix[0], y: pix[1] };
    }
    return { x: -1000, y: -1000 }; 
}

  show() {
    let pos = this.getScreenPos();
    if (pos) {
      noStroke();
      colorMode(HSB);
      fill(0, 255, 255, 100);
      ellipse(pos.x, pos.y, 4); // Increased size slightly to make it visible
    }
  }

  highlight() {
    let pos = this.getScreenPos();
    if (pos) {
      noStroke();
      colorMode(HSB);
      fill(0, 255, 255, 0.5);
      ellipse(pos.x, pos.y, 20); // Bigger highlight for easier selection
    }
  }
}
