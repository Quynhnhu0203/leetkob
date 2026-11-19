#include <iostream>
#include <queue>

// Obvious violation: directly uses std::queue
int main() {
    int q;
    if (!(std::cin >> q)) return 0;
    std::queue<int> myQueue;
    while (q--) {
        int t;
        std::cin >> t;
        if (t == 1) {
            int x;
            std::cin >> x;
            myQueue.push(x);
        } else if (t == 2) {
            std::cout << myQueue.front() << "\n";
            myQueue.pop();
        }
    }
    return 0;
}

