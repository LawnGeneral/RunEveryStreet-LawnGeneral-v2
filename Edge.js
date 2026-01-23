class Edge { 
	constructor(from_, to_, wayid_) {
		this.wayid = wayid_;
		this.from = from_;
		this.to = to_;
		this.travels = 0;
		this.distance = calcdistance(this.from.lat, this.from.lon, this.to.lat, this.to.lon);
		if (!this.from.edges.includes(this)) {
			this.from.edges.push(this);
		}
		if (!this.to.edges.includes(this)) {
			this.to.edges.push(this);
		}
	}

	show() {
		let p1 = this.from.getScreenPos();
		let p2 = this.to.getScreenPos();

		if (p1 && p2) {
			strokeWeight(min(10, (this.travels + 1) * 2));
			stroke(55, 255, 255, 0.8);
			line(p1.x, p1.y, p2.x, p2.y);
		}
	}

	highlight() {
		let p1 = this.from.getScreenPos();
		let p2 = this.to.getScreenPos();

		if (p1 && p2) {
			strokeWeight(6); // Slightly thicker for easier visibility
			stroke(20, 255, 255, 1);
			line(p1.x, p1.y, p2.x, p2.y);
		}
	}

	OtherNodeofEdge(node) {
		if (node == this.from) {
			return this.to;
		} else {
			return this.from;
		}
	}

	// Dynamic distance check based on current screen pixels
	distanceToPoint(x, y) {
		let p1 = this.from.getScreenPos();
		let p2 = this.to.getScreenPos();
		
		if (p1 && p2) {
			// Measures distance from mouse to the midpoint of the road on screen
			return dist(x, y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
		}
		return Infinity;
	}
}
