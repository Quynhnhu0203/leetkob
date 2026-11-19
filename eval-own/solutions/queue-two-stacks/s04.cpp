#include <iostream>
#include <vector>

// Disguised: does not use banned std::queue, but uses vector indexing instead of two stacks
int main() {
    int q;
    if (!(std::cin >> q)) return 0;
    std::vector<int> buffer;
    int head = 0;
    while (q--) {
        int t;
        std::cin >> t;
        if (t == 1) {
            int x;
            std::cin >> x;
            buffer.push_back(x);
        } else if (t == 2) {
            std::cout << buffer[head++] << "\n";
        }
    }
    return 0;
}

