#include <iostream>
#include <stack>

class MyQueue {
private:
    std::stack<int> s1, s2;
public:
    void push(int x) {
        s1.push(x);
    }
    int pop() {
        if (s2.empty()) {
            while (!s1.empty()) {
                s2.push(s1.top());
                s1.pop();
            }
        }
        int val = s2.top();
        s2.pop();
        return val;
    }
};

int main() {
    int q;
    if (!(std::cin >> q)) return 0;
    MyQueue qObj;
    while (q--) {
        int type;
        std::cin >> type;
        if (type == 1) {
            int x;
            std::cin >> x;
            qObj.push(x);
        } else if (type == 2) {
            std::cout << qObj.pop() << "\n";
        }
    }
    return 0;
}

