#include <iostream>
#include <thread>
#include <chrono>

// Attack 3: Wall-clock time exhaustion (sleeping / blocking without CPU usage)
int main() {
    std::this_thread::sleep_for(std::chrono::seconds(120));
    return 0;
}

