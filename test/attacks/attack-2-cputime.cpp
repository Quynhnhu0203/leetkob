#include <iostream>

// Attack 2: CPU time exhaustion
int main() {
    volatile unsigned long long x = 0;
    while (true) {
        x = x * 31 + 7;
    }
    return 0;
}

