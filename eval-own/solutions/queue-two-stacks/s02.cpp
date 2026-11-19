#include <iostream>
#include <stack>
#include <deque>
#include <utility>

// Trap: comment explicitly mentions std::queue and std::deque
// We do not use std::queue or std::deque here; we implement a custom queue!
class CustomQueue {
private:
    std::stack<int> inStack;
    std::stack<int> outStack;
public:
    void enqueue(int val) {
        inStack.push(val);
    }
    int dequeue() {
        if (outStack.empty()) {
            while (!inStack.empty()) {
                outStack.push(inStack.top());
                inStack.pop();
            }
        }
        int res = outStack.top();
        outStack.pop();
        return res;
    }
};

int main() {
    int q;
    if (!(std::cin >> q)) return 0;
    CustomQueue qObj;
    while (q--) {
        int t;
        std::cin >> t;
        if (t == 1) {
            int x;
            std::cin >> x;
            qObj.enqueue(x);
        } else if (t == 2) {
            std::cout << qObj.dequeue() << "\n";
        }
    }
    return 0;
}

