class Edge { 
    constructor(from_, to_, wayid_) {
        this.wayid = wayid_;
        this.from = from_;
        this.to = to_;
        this.travels = 0;
        this.isDoubled = false; // <--- THE MASTER PLAN PROPERTY
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
            push(); // Protects other drawing settings
            if (this.isDoubled) {
                // Purple/Magenta: Highlighting roads chosen for backtracking
                stroke(300, 255, 255, 0.9); 
                strokeWeight(6); 
            } else {
                // Cyan/Light Blue: Normal roads
                stroke(180, 255, 255, 0.8);
                strokeWeight(min(10, (this.travels + 1) * 2));
            }
            line(p1.x, p1.y, p2.x, p2.y);
            pop();
        }
    }

    highlight() {
        let p1 = this.from.getScreenPos();
        let p2 = this.to.getScreenPos();

        if (p1 && p2) {
            strokeWeight(8); 
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

    distanceToPoint(x, y) {
        let p1 = this.from.getScreenPos();
        let p2 = this.to.getScreenPos();
        
        if (p1 && p2) {
            return dist(x, y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        }
        return Infinity;
    }
}
