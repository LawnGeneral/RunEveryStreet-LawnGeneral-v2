class Node {
  constructor(nodeId_, lat_, lon_) {
    this.nodeId = nodeId_;
    this.lat = parseFloat(lat_);
    this.lon = parseFloat(lon_);
    this.edges = [];
  }

  // Get current screen pixel position from OpenLayers map
  getPixel() {
    const coord3857 = ol.proj.fromLonLat([this.lon, this.lat]);
    return openlayersmap.getPixelFromCoordinate(coord3857); // [x,y]
  }

  show() {
    const px = this.getPixel();
    if (!px) return;

    noStroke();
    colorMode(HSB);
    fill(0, 255, 255, 100);
    ellipse(px[0], px[1], 2);
  }

  highlight() {
    const px = this.getPixel();
    if (!px) return;

    noStroke();
    colorMode(HSB);
    fill(0, 255, 255, 0.5);
    ellipse(px[0], px[1], 15);
  }
}
