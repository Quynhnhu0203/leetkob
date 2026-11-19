import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  checkHardRule,
  isBanListConstraint,
  extractBannedNames,
} from "../../src/reviewer/hard-rules.js";

describe("Hard Rules — Ban List Constraint Detection", () => {
  it("identifies ban-list constraints vs semantic constraints", () => {
    expect(isBanListConstraint("Do not call a library sort function: `std::sort`, `qsort`.")).toBe(
      true,
    );
    expect(isBanListConstraint("Do not use any of these standard containers: `std::vector`.")).toBe(
      true,
    );
    expect(
      isBanListConstraint("Sort with a merge sort you wrote yourself: split the range..."),
    ).toBe(false);
  });

  it("extracts banned identifiers from backticks", () => {
    const text = "Do not call a library sort function: `std::sort`, `std::stable_sort`, `qsort`.";
    const banned = extractBannedNames(text);
    expect(banned).toEqual(["std::sort", "std::stable_sort", "qsort"]);
  });
});

describe("Hard Rules — Traps and Syntax Awareness", () => {
  const c1Text =
    "Do not call a library sort function: `std::sort`, `std::stable_sort`, `std::partial_sort`, `std::ranges::sort`, `std::ranges::stable_sort`, `qsort`.";

  it("Trap 1: does not fire on comments mentioning banned names", () => {
    const code = `
#include <iostream>
// Notice: we do not use std::sort here, we write our own!
void myFunc() {}
int main() { return 0; }
`;
    const res = checkHardRule(code, c1Text);
    expect(res.isBanList).toBe(true);
    expect(res.verdict).toBe("pass");
    expect(res.evidence).toEqual([]);
  });

  it("Trap 2: does not fire on string literals containing banned names", () => {
    const code = `
#include <iostream>
int main() {
    std::cout << "Error: std::sort is strictly prohibited in this lab" << std::endl;
    return 0;
}
`;
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("pass");
    expect(res.evidence).toEqual([]);
  });

  it("Trap 3: does not fire on #include <algorithm> when used only for std::min or std::swap", () => {
    const code = `
#include <algorithm>
#include <iostream>
int main() {
    int a = 5, b = 10;
    std::swap(a, b);
    std::cout << std::min(a, b) << std::endl;
    return 0;
}
`;
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("pass");
    expect(res.evidence).toEqual([]);
  });

  it("Trap 4: does not fire when student defines own sort in a namespace", () => {
    const code = `
namespace my {
    void sort(int* a, int lo, int hi) {
        // student's own sort
    }
}
int main() {
    int a[10];
    my::sort(a, 0, 10);
    return 0;
}
`;
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("pass");
    expect(res.evidence).toEqual([]);
  });

  it("Violation: catches explicit std::sort call", () => {
    const code = `
#include <iostream>
#include <vector>
#include <algorithm>
int main() {
    std::vector<int> a = {3, 1, 2};
    std::sort(a.begin(), a.end());
    return 0;
}
`;
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("violation");
    expect(res.evidence?.length).toBeGreaterThan(0);
    expect(res.evidence?.[0]?.text).toContain("std::sort");
  });

  it("Violation: catches unqualified sort with using namespace std", () => {
    const code = `
#include <iostream>
#include <algorithm>
using namespace std;
int main() {
    int a[3] = {3, 1, 2};
    sort(a, a + 3);
    return 0;
}
`;
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("violation");
    expect(res.evidence?.length).toBeGreaterThan(0);
    expect(res.evidence?.[0]?.text).toContain("sort(a, a + 3)");
  });

  it("Violation: catches macro that expands to banned sort", () => {
    const code = `
#include <iostream>
#include <algorithm>
#define SORT(v) std::sort(v.begin(), v.end())
int main() {
    std::vector<int> v;
    SORT(v);
    return 0;
}
`;
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("violation");
    expect(res.evidence?.length).toBe(2);
  });
});

describe("Hard Rules on dev set sort-merge solutions", () => {
  const c1Text =
    "Do not call a library sort function: `std::sort`, `std::stable_sort`, `std::partial_sort`, `std::ranges::sort`, `std::ranges::stable_sort`, `qsort`.";
  const solDir = path.resolve(__dirname, "../../eval/solutions/sort-merge");

  it("s01.cpp passes C1", () => {
    const code = fs.readFileSync(path.join(solDir, "s01.cpp"), "utf8");
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("pass");
  });

  it("s02.cpp (trap: includes algorithm for min) passes C1", () => {
    const code = fs.readFileSync(path.join(solDir, "s02.cpp"), "utf8");
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("pass");
  });

  it("s03.cpp (trap: comment mentions std::sort, my::sort) passes C1", () => {
    const code = fs.readFileSync(path.join(solDir, "s03.cpp"), "utf8");
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("pass");
  });

  it("s04.cpp (violation: sort with using namespace std) fails C1", () => {
    const code = fs.readFileSync(path.join(solDir, "s04.cpp"), "utf8");
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("violation");
    expect(res.evidence?.[0]?.line).toBe(11);
  });

  it("s05.cpp (violation: stable_sort) fails C1", () => {
    const code = fs.readFileSync(path.join(solDir, "s05.cpp"), "utf8");
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("violation");
    expect(res.evidence?.[0]?.line).toBe(12);
  });

  it("s08.cpp (violation: macro SORT) fails C1", () => {
    const code = fs.readFileSync(path.join(solDir, "s08.cpp"), "utf8");
    const res = checkHardRule(code, c1Text);
    expect(res.verdict).toBe("violation");
    const lines = res.evidence?.map((e) => e.line);
    expect(lines).toContain(4);
    expect(lines).toContain(25);
  });
});
