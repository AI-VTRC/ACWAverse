// Sparse symmetric positive-definite solver: reverse Cuthill-McKee ordering
// plus an envelope (skyline) Cholesky factorisation. Water networks are
// sparse and nearly tree-like, so the envelope stays narrow.

export class SkylineSolver {
  readonly n: number;
  /** perm[original] = position in the factorisation order. */
  private readonly perm: Int32Array;
  private readonly first: Int32Array;   // first stored column of each row
  private readonly offset: Int32Array;  // start of each row in `data`
  private readonly data: Float64Array;
  private readonly work: Float64Array;

  constructor(n: number, edges: Array<[number, number]>) {
    this.n = n;
    const adjacency: number[][] = Array.from({ length: n }, () => []);
    edges.forEach(([a, b]) => {
      if (a === b || a < 0 || b < 0) return;
      if (!adjacency[a].includes(b)) adjacency[a].push(b);
      if (!adjacency[b].includes(a)) adjacency[b].push(a);
    });
    this.perm = SkylineSolver.reverseCuthillMcKee(n, adjacency);
    this.first = new Int32Array(n);
    for (let i = 0; i < n; i++) this.first[i] = i;
    for (let a = 0; a < n; a++) {
      const pa = this.perm[a];
      adjacency[a].forEach(b => {
        const pb = this.perm[b];
        if (pb < pa && pb < this.first[pa]) this.first[pa] = pb;
      });
    }
    this.offset = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.offset[i + 1] = this.offset[i] + (i - this.first[i] + 1);
    this.data = new Float64Array(this.offset[n]);
    this.work = new Float64Array(n);
  }

  private static reverseCuthillMcKee(n: number, adjacency: number[][]): Int32Array {
    const order: number[] = [];
    const visited = new Uint8Array(n);
    const degree = adjacency.map(list => list.length);
    const byDegree = Array.from({ length: n }, (_, i) => i).sort((a, b) => degree[a] - degree[b]);
    byDegree.forEach(start => {
      if (visited[start]) return;
      visited[start] = 1;
      const queue = [start];
      for (let head = 0; head < queue.length; head++) {
        const node = queue[head];
        order.push(node);
        adjacency[node]
          .filter(next => !visited[next])
          .sort((a, b) => degree[a] - degree[b])
          .forEach(next => { visited[next] = 1; queue.push(next); });
      }
    });
    const perm = new Int32Array(n);
    order.reverse().forEach((node, position) => { perm[node] = position; });
    return perm;
  }

  clear(): void { this.data.fill(0); }

  /** Add `value` to entry (a, b) of the symmetric matrix (original indices). */
  add(a: number, b: number, value: number): void {
    let i = this.perm[a];
    let j = this.perm[b];
    if (j > i) { const tmp = i; i = j; j = tmp; }
    this.data[this.offset[i] + (j - this.first[i])] += value;
  }

  /** Factorise in place and solve A x = rhs. Returns false if A is not SPD. */
  solve(rhs: Float64Array, out: Float64Array): boolean {
    const { n, first, offset, data, work, perm } = this;
    for (let i = 0; i < n; i++) {
      const fi = first[i];
      const rowI = offset[i] - fi;
      for (let j = fi; j <= i; j++) {
        const fj = first[j];
        const rowJ = offset[j] - fj;
        let sum = data[rowI + j];
        for (let k = Math.max(fi, fj); k < j; k++) sum -= data[rowI + k] * data[rowJ + k];
        if (j < i) {
          data[rowI + j] = sum / data[rowJ + j];
        } else {
          if (!(sum > 0)) return false;
          data[rowI + i] = Math.sqrt(sum);
        }
      }
    }
    for (let a = 0; a < n; a++) work[perm[a]] = rhs[a];
    for (let i = 0; i < n; i++) {
      const rowI = offset[i] - first[i];
      let sum = work[i];
      for (let k = first[i]; k < i; k++) sum -= data[rowI + k] * work[k];
      work[i] = sum / data[rowI + i];
    }
    for (let i = n - 1; i >= 0; i--) {
      const rowI = offset[i] - first[i];
      const value = work[i] / data[rowI + i];
      work[i] = value;
      for (let k = first[i]; k < i; k++) work[k] -= data[rowI + k] * value;
    }
    for (let a = 0; a < n; a++) out[a] = work[perm[a]];
    return true;
  }
}
