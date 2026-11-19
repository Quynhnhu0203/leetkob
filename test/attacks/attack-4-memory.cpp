#include <iostream>
#include <vector>

// Attack 4: Memory limit exhaustion (allocates 512MB and reads back so compiler cannot remove)
int main() {
    const size_t sz = 512 * 1024 * 1024; // 512 MB, limit is 256 MB
    std::vector<char> mem(sz, 1);
    long long sum = 0;
    for (size_t i = 0; i < sz; i += 4096) {
        sum += mem[i];
    }
    std::cout << "Sum: " << sum << std::endl;
    return 0;
}

