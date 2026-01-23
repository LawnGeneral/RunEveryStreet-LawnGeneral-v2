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
    const coords = ol.proj.fromLonLat([parseFloat(this.lon), parseFloat(this.lat)]);
    const pix = openlayersmap.getPixelFromCoordinate(coords);
    if (pix) {
      return {
        x: pix[0],
        y: pix[1] // Removed the - 34 to align with the basemap
      };
    }
    return null;
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
