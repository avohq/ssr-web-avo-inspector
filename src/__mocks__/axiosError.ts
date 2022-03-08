import axios from "axios";

let axiosErrorDefaultMock = {
    post: jest.fn(() => Promise.resolve({
        status: 400,
    })),
    status: 400,
    response: "{}",
};

(axios as any).default = jest.fn(() => axiosErrorDefaultMock);

export default axiosErrorDefaultMock;
