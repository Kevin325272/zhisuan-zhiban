import type { ProgrammingLanguage } from "@xuetu/contracts";

import { getProgrammingLanguageDefinition } from "../../domain/programming-languages.js";
import type { BfsGraphCase } from "./bfs-cases.js";
import { allNodesFor } from "./bfs-cases.js";

export interface BuiltBfsProgram {
  source: string;
  fileName: string;
  entryPointMarker: string;
}

type HarnessBuilder = (source: string, graphCase: BfsGraphCase) => Omit<BuiltBfsProgram, "fileName">;

function adjacency(graphCase: BfsGraphCase) {
  const value = new Map<number, number[]>();
  for (const node of allNodesFor(graphCase)) value.set(node, []);
  for (const [from, to] of graphCase.edges) value.get(from)!.push(to);
  return value;
}

const buildCProgram: HarnessBuilder = (source, graphCase) => ({
  entryPointMarker: "int main(void)",
  source: `#include <stdio.h>\n${source}\n\nint main(void) {
  int __xuetu_graph[16][16] = {{0}};
  int __xuetu_degree[16] = {0};
${graphCase.edges
  .map(([from, to]) => `  __xuetu_graph[${from}][__xuetu_degree[${from}]++] = ${to};`)
  .join("\n")}
  int __xuetu_order[64] = {0};
  int __xuetu_count = bfs(__xuetu_graph, __xuetu_degree, ${graphCase.start}, __xuetu_order);
  for (int i = 0; i < __xuetu_count; i++) {
    if (i > 0) printf(" ");
    printf("%d", __xuetu_order[i]);
  }
  printf("\\n");
  return 0;
}`,
});

const buildCppProgram: HarnessBuilder = (source, graphCase) => ({
  entryPointMarker: "int main()",
  source: `#include <iostream>\n${source}\n\nint main() {
  vector<vector<int>> __xuetu_graph(${Math.max(...allNodesFor(graphCase)) + 1});
${graphCase.edges
  .map(([from, to]) => `  __xuetu_graph[${from}].push_back(${to});`)
  .join("\n")}
  const vector<int> __xuetu_order = bfs(__xuetu_graph, ${graphCase.start});
  for (size_t i = 0; i < __xuetu_order.size(); ++i) {
    if (i > 0) cout << ' ';
    cout << __xuetu_order[i];
  }
  cout << '\\n';
  return 0;
}`,
});

const buildJavaProgram: HarnessBuilder = (source, graphCase) => {
  const normalized = source.replace(/public\s+class\s+BfsTraversal/u, "class BfsTraversal");
  return {
    entryPointMarker: "public class Main",
    source: `${normalized}\n\npublic class Main {
  public static void main(String[] args) {
    List<List<Integer>> __xuetuGraph = new ArrayList<>();
    for (int i = 0; i < ${Math.max(...allNodesFor(graphCase)) + 1}; i++) {
      __xuetuGraph.add(new ArrayList<>());
    }
${graphCase.edges
  .map(([from, to]) => `    __xuetuGraph.get(${from}).add(${to});`)
  .join("\n")}
    List<Integer> __xuetuOrder = BfsTraversal.bfs(__xuetuGraph, ${graphCase.start});
    for (int i = 0; i < __xuetuOrder.size(); i++) {
      if (i > 0) System.out.print(" ");
      System.out.print(__xuetuOrder.get(i));
    }
    System.out.println();
  }
}`,
  };
};

const buildPythonProgram: HarnessBuilder = (source, graphCase) => {
  const graph = [...adjacency(graphCase).entries()]
    .map(([node, neighbors]) => `${node}: [${neighbors.join(", ")}]`)
    .join(", ");
  return {
    entryPointMarker: 'if __name__ == "__main__"',
    source: `${source}\n\nif __name__ == "__main__":
    __xuetu_graph = {${graph}}
    print(*bfs(__xuetu_graph, ${graphCase.start}))`,
  };
};

function buildMapProgram(
  source: string,
  graphCase: BfsGraphCase,
  typed: boolean,
): Omit<BuiltBfsProgram, "fileName"> {
  const entries = [...adjacency(graphCase).entries()]
    .map(([node, neighbors]) => `[${node}, [${neighbors.join(", ")}]]`)
    .join(", ");
  const declaration = typed
    ? `const __xuetuGraph = new Map<number, number[]>([${entries}]);`
    : `const __xuetuGraph = new Map([${entries}]);`;
  return {
    entryPointMarker: "const __xuetuGraph",
    source: `${source}\n\n${declaration}\nconsole.log(bfs(__xuetuGraph, ${graphCase.start}).join(" "));`,
  };
}

const buildGoProgram: HarnessBuilder = (source, graphCase) => {
  const normalized = source.replace(
    /^package\s+\w+\s*/u,
    'package main\n\nimport "fmt"\n\n',
  );
  const entries = [...adjacency(graphCase).entries()]
    .map(([node, neighbors]) => `    ${node}: []int{${neighbors.join(", ")}}`)
    .join(",\n");
  return {
    entryPointMarker: "func main()",
    source: `${normalized}\n\nfunc main() {
  __xuetuGraph := map[int][]int{
${entries},
  }
  __xuetuOrder := bfs(__xuetuGraph, ${graphCase.start})
  for i, value := range __xuetuOrder {
    if i > 0 { fmt.Print(" ") }
    fmt.Print(value)
  }
  fmt.Println()
}`,
  };
};

const buildRustProgram: HarnessBuilder = (source, graphCase) => ({
  entryPointMarker: "fn main()",
  source: `${source}\n\nfn main() {
    let mut __xuetu_graph: HashMap<usize, Vec<usize>> = HashMap::new();
${[...adjacency(graphCase).entries()]
  .map(
    ([node, neighbors]) =>
      `    __xuetu_graph.insert(${node}, vec![${neighbors.join(", ")}]);`,
  )
  .join("\n")}
    let __xuetu_order = bfs(&__xuetu_graph, ${graphCase.start});
    for (index, value) in __xuetu_order.iter().enumerate() {
        if index > 0 { print!(" "); }
        print!("{}", value);
    }
    println!();
}`,
});

const builders: Record<ProgrammingLanguage, HarnessBuilder> = {
  c: buildCProgram,
  cpp: buildCppProgram,
  java: buildJavaProgram,
  python: buildPythonProgram,
  javascript: (source, graphCase) => buildMapProgram(source, graphCase, false),
  typescript: (source, graphCase) => buildMapProgram(source, graphCase, true),
  go: buildGoProgram,
  rust: buildRustProgram,
};

export function buildBfsProgram(
  language: ProgrammingLanguage,
  source: string,
  graphCase: BfsGraphCase,
): BuiltBfsProgram {
  const built = builders[language](source, graphCase);
  return {
    ...built,
    fileName: getProgrammingLanguageDefinition(language).file_name,
  };
}
