// OKR Collapsible Tree — Looker Studio Community Visualization
// Wired to dscc (Data Studio Component Communication) API
// Requires: d3.js loaded via index.html

(function () {

  // ── Color scheme by node type ──────────────────────────────────────────
  const TYPE_COLORS = {
    "company":      { fill: "#5b8dee", stroke: "#3a6bcc" },
    "area":         { fill: "#38d9a9", stroke: "#20b589" },
    "team":         { fill: "#f59e42", stroke: "#d4800a" },
    "achievement":  { fill: "#a78bfa", stroke: "#7c5cbf" },
    "default":      { fill: "#94a3b8", stroke: "#64748b" }
  };

  const DEPTH_COLORS = [
    { fill: "#5b8dee", stroke: "#3a6bcc" },
    { fill: "#38d9a9", stroke: "#20b589" },
    { fill: "#f59e42", stroke: "#d4800a" },
    { fill: "#a78bfa", stroke: "#7c5cbf" }
  ];

  const NODE_RADIUS = [16, 13, 10, 8];
  const ROW_HEIGHT  = 44;
  const COL_WIDTH   = 210;

  // ── Main draw function called by dscc ─────────────────────────────────
  function drawViz(data) {
    // Clear previous render
    d3.select("body").selectAll("*").remove();

    // ── Parse style options ──
    const styleOptions  = data.style.styleOptions || {};
    const colorByType   = styleOptions.colorByType   !== false;
    const showProgress  = styleOptions.showProgress  !== false;
    const startExpanded = styleOptions.startExpanded === true;

    // ── Build flat rows from dscc data ──
    const rows = data.tables.DEFAULT.rows;
    const fields = data.tables.DEFAULT.fields;

    // Map field ids to column indices
    const idx = {};
    fields.forEach((f, i) => { idx[f.id] = i; });

    const flat = rows.map(r => ({
      id:     String(r[idx["id"]]     ?? "").trim(),
      parent: String(r[idx["parent"]] ?? "").trim(),
      label:  String(r[idx["label"]]  ?? "").trim(),
      type:   String(r[idx["type"]]   ?? "").toLowerCase().trim(),
      metric: parseFloat(r[idx["metric"]]) || null,
      target: parseFloat(r[idx["target"]]) || null
    }));

    // ── Build hierarchy from parent-child pairs ──
    const nodeMap = {};
    flat.forEach(d => {
      nodeMap[d.id] = { ...d, children: [] };
    });

    let root = null;
    flat.forEach(d => {
      const node = nodeMap[d.id];
      if (!d.parent || d.parent === "" || d.parent === "null" || !nodeMap[d.parent]) {
        // No parent → root (if multiple, wrap them)
        if (!root) {
          root = node;
        } else {
          // Multiple roots: create a virtual root
          if (root.__virtual) {
            root.children.push(node);
          } else {
            const vRoot = { id: "__root", label: "All Objectives", type: "company", metric: null, target: null, __virtual: true, children: [root, node] };
            root = vRoot;
          }
        }
      } else {
        nodeMap[d.parent].children.push(node);
      }
    });

    if (!root) {
      document.body.innerHTML = '<p style="padding:24px;color:#999;font-family:sans-serif">No data — check your ID and Parent ID fields.</p>';
      return;
    }

    // ── Layout ────────────────────────────────────────────────────────────
    const margin = { top: 20, right: 240, bottom: 20, left: 40 };
    const svgWidth  = Math.max(window.innerWidth  || 800, 600);
    const svgHeight = Math.max(window.innerHeight || 600, 400);

    const svg = d3.select("body").append("svg")
      .attr("width",  "100%")
      .attr("height", "100%")
      .style("font-family", "sans-serif")
      .style("background", "transparent");

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const treeFn = d3.tree().nodeSize([ROW_HEIGHT, COL_WIDTH]);

    // ── Convert to d3 hierarchy ──
    const hierarchy = d3.hierarchy(root, d => d.children.length ? d.children : null);

    // Collapse to first level unless startExpanded
    if (!startExpanded) {
      hierarchy.children && hierarchy.children.forEach(collapseDeep);
    }

    let uid = 0;

    function collapseDeep(d) {
      if (d.children) {
        d._children = d.children;
        d._children.forEach(collapseDeep);
        d.children = null;
      }
    }

    function getColor(d) {
      if (colorByType && d.data.type && TYPE_COLORS[d.data.type]) {
        return TYPE_COLORS[d.data.type];
      }
      return DEPTH_COLORS[Math.min(d.depth, DEPTH_COLORS.length - 1)];
    }

    function getR(d) {
      return NODE_RADIUS[Math.min(d.depth, NODE_RADIUS.length - 1)];
    }

    function diagonal(d) {
      return `M${d.source.y},${d.source.x}
              C${(d.source.y + d.target.y) / 2},${d.source.x}
               ${(d.source.y + d.target.y) / 2},${d.target.x}
               ${d.target.y},${d.target.x}`;
    }

    function update(source) {
      const treeData = treeFn(hierarchy);
      const nodes    = treeData.descendants();
      const links    = treeData.links();

      // Re-center vertically
      const xs   = nodes.map(d => d.x);
      const minX = Math.min(...xs);
      g.attr("transform", `translate(${margin.left},${margin.top + (-minX)})`);

      const dur = 280;

      // ── Links ──
      const link = g.selectAll(".link").data(links, d => d.target.id);

      const linkEnter = link.enter().insert("path", "g")
        .attr("class", "link")
        .attr("fill", "none")
        .attr("stroke", "#334155")
        .attr("stroke-width", 1.5)
        .attr("stroke-linecap", "round")
        .attr("d", () => {
          const o = { x: source.x0 ?? 0, y: source.y0 ?? 0 };
          return diagonal({ source: o, target: o });
        });

      link.merge(linkEnter).transition().duration(dur)
        .attr("d", diagonal);

      link.exit().transition().duration(dur)
        .attr("d", () => {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o });
        })
        .remove();

      // ── Nodes ──
      const node = g.selectAll(".node").data(nodes, d => d.id || (d.id = ++uid));

      const nodeEnter = node.enter().append("g")
        .attr("class", "node")
        .attr("transform", `translate(${source.y0 ?? 0},${source.x0 ?? 0})`)
        .attr("opacity", 0)
        .style("cursor", d => (d.children || d._children) ? "pointer" : "default")
        .on("click", (event, d) => {
          if (d.children) {
            d._children = d.children;
            d.children  = null;
          } else if (d._children) {
            d.children  = d._children;
            d._children = null;
          }
          update(d);
        });

      // Circle
      nodeEnter.append("circle")
        .attr("r", 0)
        .attr("fill",         d => d._children ? getColor(d).fill : (d.children ? "#1e293b" : getColor(d).fill))
        .attr("stroke",       d => getColor(d).stroke)
        .attr("stroke-width", 2.5);

      // Collapse indicator (+N)
      nodeEnter.append("text")
        .attr("class", "collapse-hint")
        .attr("x", d => -(getR(d) + 5))
        .attr("text-anchor", "end")
        .attr("dy", "0.35em")
        .attr("font-size", "9px")
        .attr("fill", "#64748b")
        .attr("font-family", "monospace");

      // Label
      nodeEnter.append("text")
        .attr("class", "node-label")
        .attr("x",     d => getR(d) + 10)
        .attr("dy",    d => (showProgress && d.data.metric !== null) ? "-0.55em" : "0.35em")
        .attr("font-size",   d => d.depth === 0 ? "13px" : "12px")
        .attr("font-weight", d => d.depth <= 1  ? "600"  : "400")
        .attr("fill", "#e2e4ed")
        .attr("paint-order", "stroke")
        .attr("stroke", "rgba(15,17,23,0.8)")
        .attr("stroke-width", "3px")
        .attr("stroke-linejoin", "round")
        .text(d => d.data.label);

      // Progress bar + metric text (optional)
      if (showProgress) {
        const barW = 90, barH = 5;

        // Background bar
        nodeEnter.filter(d => d.data.metric !== null).append("rect")
          .attr("class", "progress-bg")
          .attr("x",      d => getR(d) + 10)
          .attr("y",      "6")
          .attr("width",  barW)
          .attr("height", barH)
          .attr("rx",     3)
          .attr("fill",   "#1e293b");

        // Foreground bar
        nodeEnter.filter(d => d.data.metric !== null).append("rect")
          .attr("class", "progress-fill")
          .attr("x",      d => getR(d) + 10)
          .attr("y",      "6")
          .attr("width",  0)
          .attr("height", barH)
          .attr("rx",     3)
          .attr("fill",   d => getColor(d).fill);

        // Metric text
        nodeEnter.filter(d => d.data.metric !== null).append("text")
          .attr("class", "metric-text")
          .attr("x",         d => getR(d) + 10 + barW + 6)
          .attr("y",         "9")
          .attr("dy",        "0.35em")
          .attr("font-size", "10px")
          .attr("font-family", "monospace")
          .attr("fill", "#64748b");
      }

      // ── Merge & transition ──
      const nodeUpdate = node.merge(nodeEnter);

      nodeUpdate.transition().duration(dur)
        .attr("transform", d => `translate(${d.y},${d.x})`)
        .attr("opacity", 1);

      nodeUpdate.select("circle").transition().duration(dur)
        .attr("r",    d => getR(d))
        .attr("fill", d => d._children ? getColor(d).fill : (d.children ? "#1e293b" : getColor(d).fill))
        .attr("stroke", d => getColor(d).stroke);

      nodeUpdate.select(".collapse-hint")
        .text(d => d._children ? `+${d._children.length}` : "");

      nodeUpdate.select(".node-label")
        .attr("dy", d => (showProgress && d.data.metric !== null) ? "-0.55em" : "0.35em");

      if (showProgress) {
        nodeUpdate.select(".progress-fill").transition().duration(dur)
          .attr("width", d => {
            if (d.data.target) return Math.min((d.data.metric / d.data.target) * 90, 90);
            return Math.min(d.data.metric, 90);
          });

        nodeUpdate.select(".metric-text")
          .text(d => {
            if (d.data.target) {
              const pct = Math.round((d.data.metric / d.data.target) * 100);
              return `${pct}%`;
            }
            return d.data.metric;
          });
      }

      node.exit().transition().duration(dur)
        .attr("transform", `translate(${source.y},${source.x})`)
        .attr("opacity", 0)
        .remove();

      nodes.forEach(d => { d.x0 = d.x; d.y0 = d.y; });
    }

    // Initial position
    hierarchy.x0 = 0;
    hierarchy.y0 = 0;
    update(hierarchy);
  }

  // ── Subscribe to Looker Studio data updates ────────────────────────────
  // dscc is injected by Looker Studio at runtime
  if (typeof dscc !== "undefined") {
    dscc.subscribeToData(drawViz, { transform: dscc.objectTransform });
  } else {
    // Fallback: render with sample data when opened standalone (for testing)
    drawViz(SAMPLE_DATA);
  }

  // ── Sample data for standalone testing ────────────────────────────────
  const SAMPLE_DATA = {
    style: { styleOptions: { colorByType: true, showProgress: true, startExpanded: false } },
    tables: {
      DEFAULT: {
        fields: [
          { id: "id" }, { id: "parent" }, { id: "label" },
          { id: "type" }, { id: "metric" }, { id: "target" }
        ],
        rows: [
          ["1",  "",  "Company Objectives",       "company",     82,  100],
          ["2",  "1", "Grow Revenue",              "area",        90,  100],
          ["3",  "1", "Improve Product Quality",   "area",        74,  100],
          ["4",  "1", "Scale the Team",            "area",        65,  100],
          ["5",  "2", "Sales Team",                "team",        95,  100],
          ["6",  "2", "Marketing Team",            "team",        85,  100],
          ["7",  "3", "Engineering Team",          "team",        80,  100],
          ["8",  "3", "QA Team",                   "team",        68,  100],
          ["9",  "4", "Hiring",                    "team",        70,  100],
          ["10", "5", "Close 50 new accounts",     "achievement", 47,  50 ],
          ["11", "5", "Expand 3 key accounts",     "achievement", 3,   3  ],
          ["12", "6", "Launch brand campaign",     "achievement", 1,   1  ],
          ["13", "7", "Ship v2.0",                 "achievement", 0,   1  ],
          ["14", "8", "Reduce bug backlog by 40%", "achievement", 38,  40 ],
          ["15", "9", "Hire 5 engineers",          "achievement", 3,   5  ]
        ]
      }
    }
  };

})();
