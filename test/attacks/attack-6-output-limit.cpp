#include <iostream>

// Attack 6: Flood stdout with huge output
int main() {
    while (true) {
        std::cout << "Flood of output to exceed max buffer limit...\n";
    }
    return 0;
}

